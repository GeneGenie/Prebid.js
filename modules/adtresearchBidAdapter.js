import * as utils from "../src/utils";
import {registerBidder} from "../src/adapters/bidderFactory";
import {BANNER} from "../src/mediaTypes";
import findIndex from "core-js/library/fn/array/find-index";


const URL = '//research.adtelligent.com/bid';
const BIDDER_CODE = 'adtresearch';
const DISPLAY = 'display';

export const spec = {
  code: BIDDER_CODE,
  supportedMediaTypes: [BANNER],
  isBidRequestValid: function (bid) {
    return true;
  },
  buildRequests: function (bidRequests, bidderRequest) {
    return {
      headers: {'Content-Type': 'application/json'},
      data: bidToTag(bidRequests, bidderRequest),
      bidderRequest,
      method: 'POST',
      url: URL
    };
  },
  interpretResponse: function (serverResponse, {bidderRequest}) {
    serverResponse = serverResponse.body;
    let bids = [];

    if (!utils.isArray(serverResponse.bids)) {
      return bids;
    }

    serverResponse.bids.forEach(serverBidResponse => {
      bids = utils.flatten(bids, parseRTBResponse(serverBidResponse, bidderRequest));
    });

    return bids;
  },

  getUserSyncs: function (syncOptions, serverResponses) {
  },
  onTimeout: function (timeoutData) {
  },
  onBidWon: function (bid) {
  },
  onSetTargeting: function (bid) {
  }
};
function parseRTBResponse(serverBid, bidderRequest) {
  const bids = [];
  const requestId = findIndex(bidderRequest.bids, (bidRequest) => {
    return bidRequest.bidId === serverBid.bidId;
  });
  if (serverBid.cpm !== 0 && requestId !== -1) {
    const bid = createBid(serverBid, bidderRequest.bids[requestId]);
    bids.push(bid);
  }
  return bids;
}
function bidToTag(bidRequests, bidderRequest) {
  let tag = {
    ref: utils.getTopWindowLocation().hostname
  };
  if (window.vpb) {
    tag.vpbv = vpb.VPB_VERSION;
    tag.session_id = vpb.SESSION_ID;
  }
  const bids = [];
  for (let i = 0, length = bidRequests.length; i < length; i++) {
    bids.push(prepareRTBRequestParams(bidRequests[i]))
  }
  tag.bids = bids;
  return tag;
}

/**
 * Parse mediaType
 * @param _index {number}
 * @param bid {object}
 * @returns {object}
 */
function prepareRTBRequestParams(bid) {
  let bidReq = {
    'bidId': bid.bidId,
    'sizes': bid.sizes,
  }
  return bidReq;
}

/**
 * Configure new bid by response
 * @param bidResponse {object}
 * @param bidReq {Object}
 * @returns {object}
 */
function createBid(bidResponse, bidReq) {
  let bid = {
    creativeId: bidResponse.bidId + '_1',
    requestId: bidResponse.bidId,
    height: bidResponse.h,
    currency: bidResponse.currency,
    width: bidResponse.w,
    cpm: bidResponse.cpm,
    netRevenue: true,
    mediaType: DISPLAY,
    ad: bidResponse.ad,
    ttl: 3600
  };

  return bid;
}


registerBidder(spec);
