import * as utils from "src/utils";
import {registerBidder} from "src/adapters/bidderFactory";
import {VIDEO, BANNER} from "src/mediaTypes";
import {Renderer} from "src/Renderer";
import findIndex from "core-js/library/fn/array/find-index";


const URL = '//hb.adtelligent.com/v2/auction/';
const OUTSTREAM_SRC = '//player.adtelligent.com/outstream-unit/2.11/outstream-unit.min.js';
const BIDDER_CODE = 'vertamedia';
const OUTSTREAM = 'outstream';
const DISPLAY = 'display';

export const spec = {
  code: BIDDER_CODE,
  aliases: ['adtelligent', 'adtelligentMarket'],
  supportedMediaTypes: [VIDEO, BANNER],
  isBidRequestValid: function (bid) {
    return bid && bid.params && (bid.params.aid || bid.params.pid);
  },
  getUserSyncs: function (syncOptions, serverResponses) {
    var syncs = [];

    function addSyncs(bid) {
      const uris = bid.cookieURLs;
      const types = bid.cookieURLSTypes || [];

      if (uris && uris.length) {
        uris.forEach((uri, i) => {
          let type = types[i] || 'image';

          if (syncOptions.pixelEnabled && !syncOptions.iframeEnabled) {
            type = 'image';
          } else if (!syncOptions.pixelEnabled && syncOptions.iframeEnabled) {
            type = 'iframe';
          }

          syncs.push({
            type: type,
            url: uri
          })
        })
      }
    }

    if (syncOptions.pixelEnabled || syncOptions.iframeEnabled) {
      serverResponses && serverResponses.length && serverResponses.forEach((response) => {
        if (response.body) {
          response.body.forEach(b => {
            addSyncs(b);
          })

        }
      })
    }
    return syncs;
  },
  /**
   * Make a server request from the list of BidRequests
   * @param bidRequests
   * @param bidderRequest
   */
  buildRequests: function (bidRequests, bidderRequest) {
    return {
      data: bidToTag(bidRequests, bidderRequest),
      bidderRequest,
      method: 'POST',
      url: URL
    };
  },

  /**
   * Unpack the response from the server into a list of bids
   * @param serverResponse
   * @param bidderRequest
   * @return {Bid[]} An array of bids which were nested inside the server
   */
  interpretResponse: function (serverResponse, {bidderRequest}) {
    serverResponse = serverResponse.body;
    let bids = [];
    serverResponse.forEach(serverBidResponse => {
      let bid = parseRTBResponse(serverBidResponse, bidderRequest);
      if (bid) {
        bids.push(bid);
      }
    });

    return bids;
  }
};

function parseRTBResponse(serverResponse, bidderRequest) {
  const isInvalidValidResp = !serverResponse || !serverResponse.bid;

  if (isInvalidValidResp) {
    let extMessage = serverResponse && serverResponse.ext && serverResponse.ext.message ? `: ${serverResponse.ext.message}` : '';
    let errorMessage = `Empty or error bid for ${bidderRequest.bidderCode} adapter ${extMessage}`;

    utils.logError(errorMessage);

    return null;
  }
  let serverBid = serverResponse.bid;
  const requestId = findIndex(bidderRequest.bids, (bidRequest) => {
    return bidRequest.bidId === serverBid.requestId;
  });
  if (serverBid.cpm !== 0 && requestId !== -1) {
    const bid = createBid(serverBid, bidderRequest.bids[requestId]);

    return bid;
  }
  return null;
}

function bidToTag(bidRequests, bidderRequest) {
  let tag = {
    domain: utils.getTopWindowLocation().hostname
  };

  if (bidderRequest && bidderRequest.gdprConsent) {
    tag.gdpr = 1;
    tag.gdpr_consent = bidderRequest.gdprConsent.consentString;
  }

  tag.bids = bidRequests.map(prepareRTBRequestParams);

  return tag;
}

/**
 * Parse mediaType
 * @param _index {number}
 * @param bid {object}
 * @returns {object}
 */
function prepareRTBRequestParams(bid) {
  const mediaType = utils.deepAccess(bid, 'mediaTypes.video') ? VIDEO : DISPLAY;

  let bidReq = {
    'callbackId': bid.bidId,
    'ad_type': mediaType,
    'sizes': utils.parseSizesInput(bid.sizes).map(sizeStr => {
      let [w,h] = sizeStr.split('x')
      return {w, h}
    })
  };
  
  if (bid.params.pid) {
    bidReq.pid = bid.params.pid
  } else if (bid.params.aid) {
    bidReq.aid = bid.params.aid
  }

  return bidReq;
}

/**
 * Prepare all parameters for request
 * @param bidderRequest {object}
 * @returns {object}
 */
function getMediaType(bidderRequest) {
  const videoMediaType = utils.deepAccess(bidderRequest, 'mediaTypes.video');
  const context = utils.deepAccess(bidderRequest, 'mediaTypes.video.context');

  return !videoMediaType ? DISPLAY : context === OUTSTREAM ? OUTSTREAM : VIDEO;
}

/**
 * Configure new bid by response
 * @param bidResponse {object}
 * @param bidReq {Object}
 * @returns {object}
 */
function createBid(bidResponse, bidReq) {
  let mediaType = getMediaType(bidReq);
  let bid = {
    requestId: bidResponse.requestId,
    creativeId: bidResponse.cmpId,
    height: bidResponse.height,
    currency: bidResponse.cur,
    width: bidResponse.width,
    cpm: bidResponse.cpm,
    netRevenue: true,
    mediaType,
    params: bidReq.params,
    ttl: 3600
  };

  if (mediaType === DISPLAY) {
    return Object.assign(bid, {
      ad: bidResponse.ad
    });
  }

  Object.assign(bid, {
    vastUrl: bidResponse.vastUrl
  });

  if (mediaType === OUTSTREAM) {
    Object.assign(bid, {
      mediaType: 'video',
      adResponse: bidResponse,
      renderer: newRenderer(bidResponse)
    });
  }

  return bid;
}

/**
 * Create Vertamedia renderer
 * @param bidResponse {object}
 * @returns {*}
 */
function newRenderer(bidResponse) {
  const renderer = Renderer.install({
    id: bidResponse.requestId,
    url: OUTSTREAM_SRC,
    loaded: false
  });

  renderer.setRender(outstreamRender);

  return renderer;
}

/**
 * Initialise Vertamedia outstream
 * @param bid
 */
function outstreamRender(bid) {
  bid.renderer.push(() => {
    window.VOutstreamAPI.initOutstreams([{
      width: bid.width,
      height: bid.height,
      vastUrl: bid.vastUrl,
      elId: bid.adUnitCode,
      type: bid.params.type,
      audio_setting: bid.params.audio_setting,
      default_volume: bid.params.default_volume,
      video_controls: bid.params.video_controls,
      close_button_options: bid.params.close_button_options,
      view_out_action: bid.params.view_out_action
    }]);
  });
}

registerBidder(spec);
