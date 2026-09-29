import { catalog, money, validateOrder } from './catalog.js';

const $ = id => document.getElementById(id);
const form = $('checkoutForm');
const fields = ['kit', 'fullName', 'email', 'phone', 'address'];
const storageKey = 'herrhythm_pending_order';
let key = null;
let busy = false;
let enabled = false;
let pendingInput = null;
let mode = 'test';
const params = new URLSearchParams(location.search);
const incomingKey = params.get('order');
// Remove receipt keys and provider query parameters before loading any third-party content.
history.replaceState(null, '', location.pathname + (params.has('kit') ? '?kit=' + encodeURIComponent(params.get('kit')) : ''));
try { key = incomingKey || sessionStorage.getItem(storageKey); } catch { key = incomingKey; }
if (key && !/^[0-9a-f-]{36}$/i.test(key)) key = null;
if (key) { try { sessionStorage.setItem(storageKey, key); } catch {} }
if (params.has('kit') && catalog.some(item => item.id === params.get('kit'))) $('kit').value = params.get('kit');

function notice(message, state = 'info') {
  $('checkoutStatus').textContent = (enabled && mode === 'test' ? 'TEST MODE — no live payment. ' : '') + message;
  $('checkoutStatus').dataset.state = state;
}
function summary(kitId = $('kit').value, amount) {
  const kit = catalog.find(item => item.id === kitId);
  if (!kit) return;
  $('kit').value = kit.id;
  $('kitName').textContent = kit.name;
  $('kitDescription').textContent = kit.description;
  $('subtotal').textContent = $('total').textContent = money(amount ?? kit.amount);
  $('payCta').textContent = 'Pay ' + money(amount ?? kit.amount) + ' with Paystack →';
}
function errors(values) {
  fields.forEach(id => {
    $(id + 'Error').textContent = values[id] || '';
    $(id).setAttribute('aria-invalid', values[id] ? 'true' : 'false');
  });
  const first = fields.find(id => values[id]);
  if (first) $(first).focus();
}
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.message || 'Checkout unavailable.'), { status: response.status, errors: data.errors, order: data.order });
  return data;
}
function render(order) {
  summary(order.kit, order.amount);
  $('totalLabel').textContent = order.status === 'paid' ? 'Total paid' : 'Total due';
  $('paymentStep').classList.toggle('is-current', order.status !== 'paid');
  $('confirmationStep').classList.toggle('is-current', order.status === 'paid');
  $('orderReference').textContent = 'Order reference: ' + order.reference;
  $('orderFields').disabled = true;
  $('payCta').hidden = true;
  $('resumePayment').hidden = true;
  $('retryPayment').hidden = order.status !== 'pending' || Boolean(order.paymentUrl);
  $('checkStatus').hidden = order.status === 'paid';
  $('newOrder').hidden = !['paid', 'failed'].includes(order.status);
  if (order.status === 'paid') {
    notice('Payment confirmed. Thank you! Your order is recorded for fulfilment. Keep the reference below and contact us if you need delivery help.', 'success');
    $('newOrder').textContent = 'Start another order';
  } else if (order.status === 'failed') {
    notice('Payment failed. This order is not paid. You can start a new payment attempt or contact us with the reference below.', 'error');
    $('newOrder').textContent = 'Try a new payment';
  } else {
    notice('Payment is not confirmed yet. If you cancelled or closed Paystack, continue the existing payment or check its status. If money was deducted, do not pay again; contact us with your reference.');
    if (order.paymentUrl) {
      const url = new URL(order.paymentUrl);
      if (url.origin === 'https://checkout.paystack.com') {
        $('resumePayment').href = url.href;
        $('resumePayment').hidden = false;
      }
    }
  }
  $('checkoutStatus').focus();
}
async function check() {
  if (busy || !key) return;
  busy = true;
  $('checkStatus').disabled = true;
  notice('Checking payment status…');
  try { render(await request('/api/orders/status', { headers: { Authorization: 'Bearer ' + key } })); }
  catch (error) {
    if (error.order) render(error.order);
    notice(error.status === 404 ? 'No order was received. You can submit your details again.' : 'Payment status could not be confirmed. Please check again shortly. If money was deducted, contact us before paying again.', 'error');
    if (error.status === 404) reset();
  } finally { busy = false; $('checkStatus').disabled = false; }
}
function reset() {
  key = null;
  pendingInput = null;
  try { sessionStorage.removeItem(storageKey); } catch {}
  $('orderFields').disabled = !enabled;
  $('payCta').hidden = false;
  $('payCta').disabled = !enabled;
  for (const id of ['resumePayment', 'checkStatus', 'newOrder', 'retryPayment']) $(id).hidden = true;
  $('orderReference').textContent = '';
  $('totalLabel').textContent = 'Total due';
  $('paymentStep').classList.add('is-current');
  $('confirmationStep').classList.remove('is-current');
  summary();
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !enabled) return;
  const validation = validateOrder(pendingInput || Object.fromEntries(new FormData(form)));
  errors(validation.errors);
  if (Object.keys(validation.errors).length) { notice('Please correct the highlighted fields.', 'error'); return; }
  if (!key) key = crypto.randomUUID();
  try { sessionStorage.setItem(storageKey, key); } catch {
    notice('Allow session storage before paying so your order can be recovered after a redirect.', 'error'); return;
  }
  pendingInput = validation.order;
  busy = true;
  $('payCta').disabled = true;
  $('orderFields').disabled = true;
  notice('Creating your order and opening secure payment…');
  try {
    const order = await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(pendingInput) });
    render(order);
    if (order.status === 'pending' && !$('resumePayment').hidden) location.assign($('resumePayment').href);
  } catch (error) {
    if ([422, 400, 403, 415, 503].includes(error.status)) {
      reset();
      errors(error.errors || {});
      notice(error.message, 'error');
    } else {
      if (error.order) render(error.order);
      notice('We could not open payment. Your attempt is saved. Check status or retry the same order; do not start a second payment if money was deducted.', 'error');
      $('checkStatus').hidden = false;
      $('payCta').textContent = 'Retry this order';
    }
  } finally { busy = false; $('payCta').disabled = false; }
});
$('kit').addEventListener('change', () => summary());
$('checkStatus').addEventListener('click', check);
$('retryPayment').addEventListener('click', async () => {
  if (busy || !key) return;
  busy = true;
  $('retryPayment').disabled = true;
  notice('Reopening the same order…');
  try {
    render(await request('/api/orders/retry', { method: 'POST', headers: { Authorization: 'Bearer ' + key } }));
    if (!$('resumePayment').hidden) location.assign($('resumePayment').href);
  } catch (error) {
    if (error.order) render(error.order);
    notice('Payment could not be reopened. Check status or contact us with your order reference. Do not start another payment if money was deducted.', 'error');
  } finally { busy = false; $('retryPayment').disabled = false; }
});
$('newOrder').addEventListener('click', () => { reset(); notice('Choose your kit and review your details.'); $('kit').focus(); });
summary();
try {
  const config = await request('/api/checkout');
  enabled = config.enabled === true;
  mode = config.mode;
  if (!enabled) notice('Online payment is not available yet. Contact HerRhythm using the link below to order.', 'error');
  else if (key) {
    $('checkStatus').hidden = false;
    $('payCta').hidden = true;
    await check();
  } else {
    $('orderFields').disabled = false;
    $('payCta').disabled = false;
    notice('Review your kit, contact and delivery details before continuing to Paystack.');
    if (params.has('kit') && !catalog.some(item => item.id === params.get('kit'))) notice('That kit is unavailable. Please choose a kit below.', 'error');
  }
} catch {
  notice('Online checkout could not load. Refresh to try again or contact HerRhythm to order. No payment has been started by this page.', 'error');
}
