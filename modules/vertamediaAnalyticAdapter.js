/**
 * vertamediaAnalyticAdapter.js - Prebid Analytics Adapter
 * will be replaced to `node_modules/prebid.js/modules` by gulp
 */

import adapter from "src/AnalyticsAdapter";
import adaptermanager from "src/adaptermanager";
import CONSTANTS from "src/constants.json";
import events from "src/events";
import * as utils from "src/utils";
import lodash_find from "lodash/find";
import lodash_debounce from "lodash/debounce";
import lodash_once from "lodash/once";
const AUCTION_INIT = CONSTANTS.EVENTS.AUCTION_INIT;
const AUCTION_END = CONSTANTS.EVENTS.AUCTION_END;
const BID_REQUESTED = CONSTANTS.EVENTS.BID_REQUESTED;
const BID_TIMEOUT = CONSTANTS.EVENTS.BID_TIMEOUT;
const BID_RESPONSE = CONSTANTS.EVENTS.BID_RESPONSE;
const BID_WON = CONSTANTS.EVENTS.BID_WON;
const BID_ADJUSTMENT = CONSTANTS.EVENTS.BID_ADJUSTMENT;

const HB_AUCTION_DONE_CODE = 8
const DFP_RESPONSE_RECEIVED_CODE = 9
const BIDDER_INIT_CODE = 10

const analyticsType = 'bundle'
const handler = 'on'
const AD_TYPES = {
    video: 0,
    display: 1,
}
const LOG_FLUSH_TIMEOUT = 2000

let outstreamConfig
let handlers
let remote = 'adtelligent.com'
let adapterStartTime
let auctionStartTime
let isAnalyticsEnabled = false
let auctionUnits = {};


class Logger {
    constructor() {
        this.subRoute = 'adunit/multitracking';
        this.method = 'POST'

        this.flushLog = lodash_debounce(this._flushLog.bind(this), LOG_FLUSH_TIMEOUT, {
            leading: false,
            trailing: true,
            maxWait: 10000
        })

        const googleUtm = this.getUtmFromGoogleCookie()

        this._logRequest = {
            sessionID: vpb.SESSION_ID,
            vpbv: vpb.VPB_VERSION,
            fullPageURL: Logger.contentPageUrl(),
            utmMedium: this.getParameterByName('utm_medium') || googleUtm['utmcmd'],
            utmSource: this.getParameterByName('utm_source') || googleUtm['utmcsr'],
            events: []
        }
    }

    _findAdUnitEntity(code) {
        return code ? lodash_find(outstreamConfig.slots, {code: code}) : null
    }

    getUtmFromGoogleCookie() {
        if (!document.cookie) return {};
        var cookie = document.cookie.match('__utmz_gtm=([^;]*)');
        if (cookie && cookie.length) {
            var cookieValue = cookie[1];
            if (cookieValue) {
                var map = {};
                var parts = cookieValue.split('|');
                for (var i = 0; i < parts.length; i++) {
                    var _p = parts[i].split('=');
                    map[_p[0]] = _p[1];
                }
                return map;
            }
        }
        return {};
    }

    getParameterByName(name, url) {
        if (!url) url = window.location.href;
        name = name.replace(/[[\]]/g, "\\$&");
        var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
            results = regex.exec(url);
        if (!results) return '';
        if (!results[2]) return '';
        return decodeURIComponent(results[2].replace(/\+/g, " "));
    }

    log(params) {
        const entity = this._findAdUnitEntity(params.code);

        if (!entity) {
            console.error(`Entity ${params.code} not found`)
            return
        }

        const logEvent = {
            ttems: Math.max(0, Date.now() - auctionStartTime),
            lifecycleTTEms: Math.max(0, Date.now() - adapterStartTime),
            event: params.event,
            divID: entity.divId,
            adType: params.adType,
            adunitID: entity.entityID,
            clientID: vpb.utils.getClientId(),
            siteID: vpb.utils.getSiteId(),
            fullName: entity.fullName,
            adUnitCode: `/${entity.networkCode}/${entity.name}`,
            bidders: Array.isArray(params.bidders) ? params.bidders : []
        };
        if (vpb.sendHbDivId) {
            logEvent.hbDivId = params.code;
        }

        this._logRequest.events.push(logEvent);
        this.flushLog();
    }

    _flushLog() {
        const logRequest = this._logRequest
        const {events} = logRequest

        if (!events.length) return

        Logger.ajax(this.method, this.loggerUrl(), logRequest);
        events.splice(0, events.length)
    }

    static contentPageUrl() {
        var parentWindowLocationHref;

        try {
            parentWindowLocationHref = window.parent.location.href;
        } catch (err) {
            parentWindowLocationHref = '';
        }

        return window.location.href !== parentWindowLocationHref ? document.referrer : window.location.href;
    }

    static ajax(method, url, data, cb) {
        let xdr

        try {
            xdr = new XDomainRequest();
        } catch (_) {
            xdr = null
        }

        if (XMLHttpRequest && !xdr) {
            let xhttp = new XMLHttpRequest();

            xhttp.onreadystatechange = function () {
                if (xhttp.readyState !== 4) {
                    return;
                }

                if (xhttp.status === 200) {
                    return cb && cb(xhttp.status, xhttp.responseText);
                }

                cb && cb(xhttp.status, xhttp.responseText);
            };

            xhttp.onerror = function () {
                cb && cb(xhttp.status, xhttp.responseText);
            };


            xhttp.open(method, url, true);

            try {
                xhttp.send(JSON.stringify(data || {}));
            } catch (_) {
                cb && cb(xhttp.status, xhttp.responseText);
            }
        } else {
            // Use Microsoft XDR
            xdr.onload = function () {
                cb && cb(xdr.status, xdr.responseText);
            };

            xdr.onerror = function () {
                cb && cb(xdr.status, xdr.responseText);
            };

            xdr.open(method, url, true);
            setTimeout(function () {
                xdr.send(JSON.stringify(data || {}));
            });
        }
    }

    loggerUrl() {
        return `//hb.${remote}/${this.subRoute}`;
    }
}

const logger = new Logger()

// force log flush on unload
window.addEventListener('unload', logger.flushLog.flush)

function mapSizes(array) {
    if (!array || !array.length) {
        return [{w: 1, h: 1}];
    }
    const res = [];
    array.forEach(item => {
        const [w,h] = item;
        res.push({w, h})
    });
    return res;
}

const adunitAdsRequested = {};
const adIdToBuyerId = {};
const adunitAdsResponded = {};
const adunitCodeToUnit = {};
const slotsToWait = {};

const setSlotRenderEndedListener = lodash_once(() => {
    window.googletag.cmd.push(function () {
        //window.googletag.pubads().addEventListener('slotOnload', handleSlotRenderEnded)
        window.googletag.pubads().addEventListener('slotRenderEnded', handleSlotRenderEnded)
    })
})
function setBidInfo(trackBid, bidResponse) {


    trackBid.originalBid = bidResponse.originalCpm * 1;
    trackBid.originalCurrency = bidResponse.originalCurrency;

    trackBid.grossBid = bidResponse.grossBid * 1;
    trackBid.netBid = bidResponse.netBid * 1;

    trackBid.currency = bidResponse.currency;
    trackBid.bid = parseFloat(bidResponse.cpm || 0);

    return trackBid;
}
const vertamediaAnalyticsAdapter = Object.assign(adapter({
    analyticsType,
    handler,
    global: 'vertamediaAnalyticAdapter'
}), {
    track({eventType, args}) {
        console.log('STAT', eventType, args)
        if (eventType === AUCTION_INIT) {
            let currentUnits = outstreamConfig.slotQue.splice(0);
            console.log('STAT init with', currentUnits);
            auctionStartTime = Date.now();  //todo
            auctionUnits[args.auctionId] = {}
            currentUnits.forEach((adUnit) => {
                const sizes = mapSizes(adUnit.sizes);
                const bidReqs = [];

                adunitCodeToUnit[adUnit.code] = adUnit;
                adunitAdsRequested[adUnit.code] = {};
                adunitAdsResponded[adUnit.code] = adunitAdsResponded[adUnit.code] || {};
                adUnit.bids.forEach(bid => {
                    bidReqs.push(
                        {
                            id: bid.id,
                            overrideId: bid.overrideId,
                            labelIds: bid.validLabelIds,
                            sizes,
                            tte: args.timeToRespond
                        })
                });
                logger.log({
                    code: adUnit.code,
                    event: BIDDER_INIT_CODE,
                    entityID: adUnit.entityId,
                    adType: AD_TYPES[adUnit.type],
                    bidReqs
                });

                if (adUnit.type !== 'video') {
                    const timeoutEvent = {
                        code: adUnit.code,
                        event: DFP_RESPONSE_RECEIVED_CODE,
                        entityID: adUnit.entityId,
                        adType: AD_TYPES[adUnit.type],
                        bidders: []
                    }
                    slotsToWait[adUnit.code] = timeoutEvent;
                }
            });
        }

        if (eventType === BID_REQUESTED) {
            for (let i = 0; i < args.bids.length; i++) {
                let bid = args.bids[i];
                let code = bid.adUnitCode;
                let bidId = bid.bidId;

                if (!auctionUnits[args.auctionId][code]) {
                    auctionUnits[args.auctionId][code] = adunitCodeToUnit[code]
                }
                adunitAdsRequested[code][bidId] = {
                    id: bid.id,
                    overrideId: bid.overrideId,
                    validLabelIds: bid.validLabelIds,
                };
                adIdToBuyerId[bidId] = {
                    id: bid.id,
                    overrideId: bid.overrideId,
                    validLabelIds: bid.validLabelIds,
                };

            }
        }

        if (eventType === BID_TIMEOUT) {

            console.log('TIMEOUT', args)
            args.forEach(bidder => {
                adunitAdsResponded[bidder.adUnitCode][bidder.bidId] = {
                    id: adunitAdsRequested[bidder.adUnitCode][bidder.bidId].id,
                    overrideId: adunitAdsRequested[bidder.adUnitCode][bidder.bidId].overrideId,
                    labelIds: adunitAdsRequested[bidder.adUnitCode][bidder.bidId].validLabelIds,
                    winner: false,
                    timeout: true
                }
            })
        }

        if (eventType === BID_RESPONSE) {
            adunitAdsResponded[args.adUnitCode][args.adId] = args;
        }

        if (eventType === AUCTION_END) {
            Object.values(auctionUnits[args.auctionId]).forEach((adUnit)=> {
                const winAdId = this.getPBWinBid(adunitAdsResponded[adUnit.code]);
                logger.log({
                    code: adUnit.code,
                    event: HB_AUCTION_DONE_CODE,
                    entityID: adUnit.entityId,
                    adType: AD_TYPES[adUnit.type],
                    bidders: this.getBidsList(
                        adunitAdsResponded[adUnit.code],
                        adunitAdsRequested[adUnit.code],
                        winAdId,
                        //adUnit.timeout_per_bidder,
                        adUnit.sizes
                    )
                });
            });
        }

        if (eventType === BID_WON) {
            const adUnit = adunitCodeToUnit[args.adUnitCode];

            logger.log({
                code: adUnit.code,
                event: DFP_RESPONSE_RECEIVED_CODE,
                entityID: adUnit.entityId,
                adType: AD_TYPES[adUnit.type],
                bidders: [setBidInfo({
                    hbAdId: args.adId,
                    winner: true,
                    tte: args.timeToRespond,
                    pmpDeal: args.dealId,
                    sizes: [{w: parseInt(args.width), h: parseInt(args.height)}],
                    timeout: false,
                    id: adIdToBuyerId[args.adId].id,
                    overrideId: adIdToBuyerId[args.adId].overrideId,
                    labelIds: adIdToBuyerId[args.adId].validLabelIds,

                }, args)]
            });

            if (slotsToWait[adUnit.code]) {
                slotsToWait[adUnit.code] = false;
            }
        }
    }
});

vertamediaAnalyticsAdapter.originEnableAnalytics = vertamediaAnalyticsAdapter.enableAnalytics;

vertamediaAnalyticsAdapter.getPBWinBid = function (bidResps) {
    var winCpm = 0,
        winAdId;


    /* for (var key in bidResps) {

     if (bidResps.hasOwnProperty(key) && bidResps[key].cpm >= winCpm && bidResps[key].status===undefined) {
     winCpm = bidResps[key].cpm;
     winAdId = key;
     }
     }*/
    var bids = Object.values(bidResps)
    var validBids = bids ? bids.filter((bid)=> {
        // if (!(bid.cpm > 0)) {
        //     console.log(bid.adId, 'adid no cpm')
        // }
        // if (bid.responseTimestamp + (bid.ttl * 1000) <= Date.now()) {
        //     console.log(bid.adId, 'adid ttl')
        // }
        // if (bid.status === 'rendered') {
        //     console.log(bid.adId, 'adid rendered')
        // }

        return bid.cpm > 0 && bid.responseTimestamp + (bid.ttl * 1000) > Date.now() && bid.status !== 'rendered' && bid.status !== 'targetingSet';
    }) : [];
    validBids.forEach((bid)=> {
        if (bid.cpm > winCpm) {
            winCpm = bid.cpm;
        }
    })
    var maxBids = validBids.reduce((maxBids, bid)=> {
        if (bid.cpm == winCpm) {
            maxBids.push(bid)
        }
        return maxBids;
    }, []).sort((a, b)=> {
        return a.responseTimestamp - b.responseTimestamp;
    });

    winAdId = maxBids.length ? maxBids[0].adId : undefined;
    console.log('Winner adid', winAdId)
    return winAdId;
};

vertamediaAnalyticsAdapter.getBidsList = function (bidResps, bidReq, winAdId, unitSizes) {
    var rec = [];
    var reqSizes = mapSizes(unitSizes);
    var winnerFound = false;
    for (var key in bidReq) {
        if (bidReq.hasOwnProperty(key)) {
            var bidResponse = bidResps[key];
            if (bidResponse) {
                var bid = {};
                if (bidResponse.timeout) {
                    bid = bidResponse;
                    bid.sizes = reqSizes;
                } else {
                    var w = parseInt(bidResponse.width), h = parseInt(bidResponse.height);
                    var isWinner = bidResponse.adId === winAdId;
                    if (isWinner) {
                        winnerFound = true;
                    }
                    bid = setBidInfo({
                        winner: isWinner,
                        tte: bidResponse.timeToRespond,
                        sizes: [{w: w, h: h}],
                        timeout: false,
                        id: adIdToBuyerId[key].id,
                        overrideId: adIdToBuyerId[key].overrideId,
                        labelIds: adIdToBuyerId[key].validLabelIds,
                        pmpDeal: bidResponse.dealId,
                        hbAdId: bidResponse.adId
                    }, bidResponse);
                    for (var i = 0; i < reqSizes.length; i++) {
                        if (!(reqSizes[i].w == w && reqSizes[i].h == h)) {
                            rec.push({
                                winner: false,
                                timeout: false,
                                sizes: [reqSizes[i]],
                                id: adIdToBuyerId[key].id,
                                overrideId: adIdToBuyerId[key].overrideId,
                                labelIds: adIdToBuyerId[key].validLabelIds,
                            });
                        }
                    }
                }
                rec.push(bid);
                if (bidResponse.adId && bidResponse.adId === winAdId && slotsToWait[bidResponse.adUnitCode]) {
                    slotsToWait[bidResponse.adUnitCode].bidders.push(vpb.utils.copy(bid));
                }
            } else {
                rec.push({
                    winner: false,
                    timeout: false,
                    sizes: reqSizes,
                    id: adIdToBuyerId[key].id,
                    overrideId: adIdToBuyerId[key].overrideId,
                    labelIds: adIdToBuyerId[key].validLabelIds,
                });
            }
        }
    }
    if (!winnerFound) {
        bidResponse = bidResps[winAdId];
        if (bidResponse) {
            var bid = setBidInfo({
                winner: true,
                tte: bidResponse.timeToRespond,
                sizes: [{w: w, h: h}],
                timeout: false,
                id: adIdToBuyerId[bidResponse.adId].id,
                overrideId: adIdToBuyerId[bidResponse.adId].overrideId,
                labelIds: adIdToBuyerId[bidResponse.adId].validLabelIds,
                pmpDeal: bidResponse.dealId,
                hbAdId: bidResponse.adId
            }, bidResponse);
            if (slotsToWait[bidResponse.adUnitCode]) {
                slotsToWait[bidResponse.adUnitCode].bidders.push(bid);
            }
            rec.push(bid)
        }

    }
    return rec;
};

vertamediaAnalyticsAdapter.enableAnalytics = function (config) {
    if (outstreamConfig) {
        // vertamediaAnalyticsAdapter.disableAnalytics();

        outstreamConfig.slotQue = outstreamConfig.slotQue.concat(config.options.slots)
        outstreamConfig.slots = outstreamConfig.slots.concat(config.options.slots)
        return;
    }

    isAnalyticsEnabled = true;
    outstreamConfig = config.options;
    outstreamConfig.slotQue = config.options.slots.slice(0);
    adapterStartTime = Date.now();
    remote = outstreamConfig.host || remote;

    handlers = {
        [BID_REQUESTED]: args => this.enqueue({eventType: BID_REQUESTED, args}),
        [BID_RESPONSE]: args => this.enqueue({eventType: BID_RESPONSE, args}),
        [BID_TIMEOUT]: args => this.enqueue({eventType: BID_TIMEOUT, args}),
        [BID_WON]: args => this.enqueue({eventType: BID_WON, args}),
        [BID_ADJUSTMENT]: args => this.enqueue({eventType: BID_ADJUSTMENT, args}),
        [AUCTION_END]: args => this.enqueue({eventType: AUCTION_END, args}),
        [AUCTION_INIT]: args => {
            args.config = config.options; // enableAnaltyics configuration object
            this.enqueue({eventType: AUCTION_INIT, args});
        }
    };

    utils._each(handlers, (handler, event) => {
        events.on(event, handler);
    });

    setSlotRenderEndedListener()
};

vertamediaAnalyticsAdapter.disableAnalytics = function () {
    isAnalyticsEnabled = false;

    utils._each(handlers, (handler, event) => {
        events.off(event, handler);
    });
    // force log flush, as no new events expected
    logger.flushLog.flush()
};

adaptermanager.registerAnalyticsAdapter({
    adapter: vertamediaAnalyticsAdapter,
    code: 'vertamedia'
});

function handleSlotRenderEnded(event) {
    //if (!isAnalyticsEnabled) return

    const adUnitCode = event.slot.getSlotElementId();
    const timeoutEvent = slotsToWait[adUnitCode];

    if (timeoutEvent === undefined) return;

    if (typeof timeoutEvent === 'object' && timeoutEvent.bidders.length) {
        timeoutEvent.bidders.forEach(bidder => {
            bidder.winner = false;
        });
        logger.log(timeoutEvent)
    }

    delete slotsToWait[adUnitCode];

    if (!Object.keys(slotsToWait).length) {
        logger.flushLog.flush();

        //vertamediaAnalyticsAdapter.disableAnalytics();
    }
}

export default vertamediaAnalyticsAdapter;
