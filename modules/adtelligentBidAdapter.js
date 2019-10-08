import * as utils from "../src/utils";
import {registerBidder} from "../src/adapters/bidderFactory";
import {VIDEO, BANNER} from "../src/mediaTypes";
import {Renderer} from "../src/Renderer";
import findIndex from "core-js/library/fn/array/find-index";


const URL = '//ghb.adtelligent.com/auction/';
const OUTSTREAM_SRC = '//player.adtelligent.com/outstream-unit/2.11/outstream-unit.min.js';
const BIDDER_CODE = 'adtelligent';
const OUTSTREAM = 'outstream';
const DISPLAY = 'display';

export const spec = {
  code: BIDDER_CODE,
  aliases: ['onefiftytwomedia', 'vertamedia', 'adtelligentMarket'],
  supportedMediaTypes: [VIDEO, BANNER],
  isBidRequestValid: function (bid) {
    return bid && bid.params && (bid.params.pid || bid.params.aid);
  },
  getUserSyncs: function (syncOptions, serverResponses) {
    var syncs = [];

    function addSyncs(bid) {
      const uris = bid.cookieURLs;
      const types = bid.cookieURLSTypes || [];
      let uniqSyncs = {};
      if (uris && uris.length) {
        uris.forEach((uri, i) => {
          let type = types[i] || 'image';

          if ((!syncOptions.pixelEnabled && type == 'image') ||
            (!syncOptions.iframeEnabled && type == 'iframe')) {
            return;
          }
          if (uniqSyncs[type + uri] == undefined) {
            uniqSyncs[type + uri] = 1;
            syncs.push({
              type: type,
              url: uri
            })
          }
        })
      }
    }

    if (syncOptions.pixelEnabled || syncOptions.iframeEnabled) {
      serverResponses && serverResponses.length && serverResponses.forEach((response) => {
        if (response.body) {
          if (utils.isArray(response.body)) {
            response.body.forEach(b => {
              addSyncs(b);
            })
          } else {
            addSyncs(response.body)
          }
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
      method: 'GET',
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

    if (!utils.isArray(serverResponse)) {
      return parseRTBResponse(serverResponse, bidderRequest);
    }

    serverResponse.forEach(serverBidResponse => {
      bids = utils.flatten(bids, parseRTBResponse(serverBidResponse, bidderRequest));
    });

    return bids;
  }
};

function parseRTBResponse(serverResponse, bidderRequest) {
  const isInvalidValidResp = !serverResponse || !serverResponse.bids || !serverResponse.bids.length;

  let bids = [];

  if (isInvalidValidResp) {
    let extMessage = serverResponse && serverResponse.ext && serverResponse.ext.message ? `: ${serverResponse.ext.message}` : '';
    let errorMessage = `in response for ${bidderRequest.bidderCode} adapter ${extMessage}`;


    return bids;
  }

  serverResponse.bids.forEach(serverBid => {
    const requestId = findIndex(bidderRequest.bids, (bidRequest) => {
      return bidRequest.bidId === serverBid.requestId;
    });

    if (serverBid.cpm !== 0 && requestId !== -1) {
      const bid = createBid(serverBid, bidderRequest.bids[requestId]);

      bids.push(bid);
    }
  });

  return bids;
}

function bidToTag(bidRequests, bidderRequest) {
  let tag = {
    domain: utils.getTopWindowLocation().hostname
  };
  if (window.vpb) {
    tag.vpbv = vpb.VPB_VERSION;
    tag.session_id = vpb.SESSION_ID;
  }

  if (bidderRequest && bidderRequest.gdprConsent && bidderRequest.gdprConsent.gdprApplies) {
    tag.gdpr = 1;
    tag.gdpr_consent = bidderRequest.gdprConsent.consentString;
  }

  for (let i = 0, length = bidRequests.length; i < length; i++) {
    Object.assign(tag, prepareRTBRequestParams(i, bidRequests[i]));
  }

  return tag;
}

/**
 * Parse mediaType
 * @param _index {number}
 * @param bid {object}
 * @returns {object}
 */
function prepareRTBRequestParams(_index, bid) {
  const mediaType = utils.deepAccess(bid, 'mediaTypes.video') ? VIDEO : DISPLAY;
  const index = !_index ? '' : `${_index + 1}`;
  let bidReq = {
    ['callbackId' + index]: bid.bidId,
    ['ad_type' + index]: mediaType,
    ['sizes' + index]: utils.parseSizesInput(bid.sizes).join(),
    ['label_ids' + index]: bid.validLabelIds.join()

  }
  if (bid.params.pid) {
    bidReq['pid' + index] = bid.params.pid;
    bidReq['override_id' + index]= bid.overrideId;

  } else {
    bidReq['aid' + index] = bid.params.aid;
  }
  if(bid.params.vpb_placement_id){
    bidReq['placement_id'] = bid.params.vpb_placement_id;
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
