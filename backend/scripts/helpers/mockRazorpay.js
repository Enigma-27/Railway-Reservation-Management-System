/**
 * A mock Razorpay client for the test suites (no network, no real money).
 * Same shape as the parts of the SDK the backend uses:
 *   orders.create, orders.fetchPayments, payments.fetch, payments.fetchMultipleRefund, payments.refund, payments.capture
 *
 * install() puts the mock in place through setRazorpayClientOverride and gives the suite dummy gateway keys when
 * backend/.env has none (so order creation does not answer 503). It returns helpers to add a "customer payment"
 * to an order and to make the next refund calls fail.
 */
const config = require('../../src/config/env');
const gateway = require('../../src/services/gatewayRefundService');

function install() {
  if (!config.RAZORPAY_KEY_ID) config.RAZORPAY_KEY_ID = 'rzp_test_mockkey';
  if (!config.RAZORPAY_KEY_SECRET) config.RAZORPAY_KEY_SECRET = 'mock_key_secret';

  let orderSeq = 0;
  let paySeq = 0;
  let refundSeq = 0;
  const orders = new Map();
  const refunds = [];
  const state = { refundMode: 'ok', refundCalls: 0, calls: [] };

  gateway.setRazorpayClientOverride({
    orders: {
      create: async (o) => {
        const id = `order_mock_${++orderSeq}_${Date.now()}`;
        orders.set(id, { amount: o.amount, payments: [] });
        return { id, amount: o.amount, currency: o.currency, receipt: o.receipt, status: 'created' };
      },
      fetchPayments: async (id) => ({ items: orders.has(id) ? orders.get(id).payments : [] })
    },
    payments: {
      capture: async (paymentId) => {
        for (const o of orders.values()) {
          const p = o.payments.find(x => x.id === paymentId);
          if (p) { p.status = 'captured'; return p; }
        }
        throw new Error('no such payment');
      },
      fetch: async (paymentId) => {
        for (const o of orders.values()) {
          const p = o.payments.find(x => x.id === paymentId);
          if (p) return p;
        }
        throw new Error('no such payment');
      },
      fetchMultipleRefund: async (paymentId) => ({ items: refunds.filter(r => r.payment_id === paymentId) }),
      refund: async (paymentId, body) => {
        state.refundCalls++;
        state.calls.push({ paymentId, options: body });
        if (state.refundMode === 'fail') {
          const e = new Error('mock gateway failure');
          e.error = { description: 'Gateway is down (mock)' };
          throw e;
        }
        const r = { id: `rfnd_mock_${++refundSeq}`, payment_id: paymentId, notes: body.notes, amount: body.amount };
        refunds.push(r);
        return r;
      }
    }
  });

  return {
    state,
    orders,
    /** A customer payment on an order: 'captured' (default) or 'authorized'. Returns the payment. */
    addPayment(orderId, status = 'captured', method = 'netbanking', card = null) {
      const o = orders.get(orderId);
      const p = { id: `pay_sim_mock_${++paySeq}_${Date.now().toString().slice(-6)}`, order_id: orderId, status, amount: o.amount, method };
      if (card) p.card = card;
      o.payments.push(p);
      return p;
    }
  };
}

module.exports = { install };
