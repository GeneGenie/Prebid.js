import {config} from "src/config";
import {getHook} from "../src/hook.js";
import * as utils from "src/utils";
import {STATUS} from "src/constants";

let floorConfig;
export function _setConfig(config) {
  if (!config) return;
  floorConfig = config.bidfloor;
  initBidFloor(config);
}
//_setConfig(config)


config.getConfig('bidfloor', config => _setConfig(config));

function initBidFloor() {
  if (!floorConfig || !floorConfig.check) {
    return utils.logWarn('Incorrect config of bidfloor module');
  }
  getHook('addBidResponse').before(addBidFloorResponseHook, 80);
}

export function addBidFloorResponseHook(fn,adUnitCode, bid) {


  if (floorConfig.check(bid)) {
    return fn.call(this,adUnitCode, bid)
  } else {
    return utils.logWarn('BidFloor filter out ', bid);
  }
  // arguments[1] = bidfactory.createBid(STATUS.NO_BID, {
  //   bidder: bid.bidderCode || bid.bidder,
  //   bidId: bid.adId
  // });
}
