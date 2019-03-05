const adaptermanager = require('src/adaptermanager');

const adapters = {
  adbutler: require('modules/adbutlerBidAdapter'),
  getIntent: require('modules/getIntentBidAdapter')
};

const marketConfig = [
  {bidder: 'adbutler', params: {"zoneID": "278383", "accountID": "170635"}},
  {bidder: 'adbutler', params: {"zoneID": "278383", "accountID": "170635"}},
  {bidder: 'getintent', params: {tid: 105, "pid": "inter.ua_300x250"}}
];

var Market = function Market() {

  function _callBids(params, addBidResponse, done, ajax) {
    var bidmanager = {}
    bidmanager.addBidResponse = addBidResponse;
    bidmanager.done = done;

    var promises = marketConfig.map(cnf => {
      return new Promise((resolve)=> {
        params.bids = params.bids.map(b=> {
          b.params = cnf.params
          return b;
        })
        var adapter = adaptermanager.getBidAdapter(cnf.bidder);
        if (!adapter) {
          console.log('NO adapter ' + cnf.bidder);
          return resolve();
        }
        adapter.callBids(params, (AUCode, bid)=> {
          bid.advertiser = bid.bidderCode;
          bid.bidderCode = 'market';
          bidmanager.addBidResponse(AUCode, bid);
        }, function () {
          console.log(cnf.bidder + ' done');
          resolve();
        }, ajax)
      })
    })

    Promise.all(promises).then(()=> {
      console.log('market done');
      done();
    })

  }

  return {
    callBids: _callBids
  };
};
adaptermanager.registerBidAdapter(new Market(), 'market');
module.exports = Market;
