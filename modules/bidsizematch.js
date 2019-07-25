import {config} from "src/config";
import * as utils from "src/utils";
import {STATUS} from "src/constants";
import {auctionManager} from "src/auctionManager";
import find from "core-js/library/fn/array/find";
import {getHook} from "../src/hook.js";

export function _setConfig(config) {
  if (!config) return;
  init(config.bidsizematch);
}


config.getConfig('bidsizematch', config => _setConfig(config));

function init(config) {
  if (!config.ignoreMismatchedSizes) {
    return;
  }
  getHook('addBidResponse').before(addBidSizeResponseHook, 150);
}

export function addBidSizeResponseHook(fn, adUnitCode, bid) {
  let unit = find(auctionManager.getAdUnits(), unit => unit.code == adUnitCode);
  if (unit) {
    if (unit.sizes) {
      var finding = find(unit.sizes.map(spair=> spair.join('x')), size=> size == `${bid.width}x${bid.height}`);
      if (finding) {
        fn.call(this, adUnitCode, bid)
      } else {
        utils.logWarn('bidsizematch: Bid filtered (no matching sizes)', bid, unit);
      }
    } else {
      utils.logWarn('bidsizematch: Unit should have direct sizes');
      fn.call(this, adUnitCode, bid)
    }

  } else {
    utils.logWarn('bidsizematch did not find adunit');
    fn.call(this, adUnitCode, bid)
  }
}
