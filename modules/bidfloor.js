import {config} from "src/config";
import {hooks} from "src/hook.js";
import * as utils from "src/utils";
import {STATUS} from "src/constants";

let floorConfig;
export function _setConfig(config) {
  if(!config) return;
  floorConfig = config.bidfloor;
  initBidFloor(config);
}
//_setConfig(config)


config.getConfig('bidfloor', config => _setConfig(config));

function initBidFloor() {
  if (!floorConfig || !floorConfig.check) {
    return utils.logWarn('Incorrect config of bidfloor module');
  }
  hooks['addBidResponse'].addHook(addBidFloorResponseHook, 1);
}

export function addBidFloorResponseHook(adUnitCode, bid, fn) {


  if (floorConfig.check(bid)) {
    return fn.apply(this, arguments)
  } else {
    return utils.logWarn('BidFloor filter out ', bid);
  }
  // arguments[1] = bidfactory.createBid(STATUS.NO_BID, {
  //   bidder: bid.bidderCode || bid.bidder,
  //   bidId: bid.adId
  // });
}
