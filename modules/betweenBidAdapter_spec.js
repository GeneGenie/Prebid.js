import { expect } from 'chai';
import { spec } from 'modules/betweenBidAdapter';

describe('betweenBidAdapterTests', () => {
  it('test', () => {
    expect(spec.isBidRequestValid({
      bidder: 'between',
      params: {
        placementId: 'example',
        w: 200,
        h: 400,
        s: 1112
      }
    })).to.equal(true);
  });
});
