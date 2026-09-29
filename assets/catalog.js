// Amounts are integer KES minor units. Shared by the UI and the order server.
export const catalog = Object.freeze([
  Object.freeze({ id: 'menarche', name: 'Menarche Kit', amount: 680000, description: 'One kit · packaging and delivery included' }),
  Object.freeze({ id: 'rising-moon', name: 'Rising Moon Full Kit', amount: 680000, description: 'One month · includes funding for 3 Dignikits' }),
  Object.freeze({ id: 'rising-moon-opt-out', name: 'Rising Moon Kit — Opt-out', amount: 650000, description: 'One month · without the Dignikit donation' })
]);
export const money = amount => 'KSh ' + (amount / 100).toLocaleString('en-KE');
export function validateOrder(input) {
  const errors = {};
  const clean = (key, max) => typeof input?.[key] === 'string' ? input[key].trim().slice(0, max + 1) : '';
  const order = { kit: clean('kit', 40), fullName: clean('fullName', 100), email: clean('email', 254).toLowerCase(), phone: clean('phone', 30).replace(/[\s()-]/g, ''), address: clean('address', 500) };
  if (!catalog.some(kit => kit.id === order.kit)) errors.kit = 'Choose an available kit.';
  if (order.fullName.length < 2 || order.fullName.length > 100) errors.fullName = 'Enter your full name (2–100 characters).';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.email) || order.email.length > 254) errors.email = 'Enter a valid email address.';
  order.phone = order.phone.replace(/^0(?=[17])/, '+254').replace(/^254/, '+254');
  if (!/^\+254[17]\d{8}$/.test(order.phone)) errors.phone = 'Enter a Kenyan mobile number, e.g. 0712 345 678.';
  if (order.address.length < 10 || order.address.length > 500) errors.address = 'Enter your town, street and delivery details (10–500 characters).';
  return { order, errors };
}
