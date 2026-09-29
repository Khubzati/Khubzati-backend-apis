const nodemailer = require('nodemailer');

const EMAIL_ENABLED = String(process.env.ENABLE_ORDER_EMAILS || 'true').toLowerCase() === 'true';

const asNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const safeCurrency = (currencyCode) => {
  const normalized = String(currencyCode || process.env.DEFAULT_CURRENCY || 'JOD').toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : 'JOD';
};

const formatCurrency = (value, currencyCode) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: safeCurrency(currencyCode),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(asNumber(value));

class OrderEmailService {
  constructor() {
    this.fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || '';
    this.fromName = process.env.SMTP_FROM_NAME || 'Khubzati';

    this.smtpConfig = {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    };

    this._transporter = null;
  }

  isConfigured() {
    return Boolean(
      EMAIL_ENABLED &&
        this.fromEmail &&
        this.smtpConfig.host &&
        this.smtpConfig.port &&
        this.smtpConfig.user &&
        this.smtpConfig.pass,
    );
  }

  transporter() {
    if (!this.isConfigured()) {
      return null;
    }

    if (!this._transporter) {
      this._transporter = nodemailer.createTransport({
        host: this.smtpConfig.host,
        port: this.smtpConfig.port,
        secure: this.smtpConfig.secure,
        auth: {
          user: this.smtpConfig.user,
          pass: this.smtpConfig.pass,
        },
      });
    }

    return this._transporter;
  }

  normalizeItems(order) {
    const orderItems = Array.isArray(order?.orderItems) ? order.orderItems : [];
    return orderItems.map((item) => {
      const qty = Number(item.quantity || 0);
      const fallbackSubtotal = Number(item.price || 0) * qty;
      const subtotal = Number(item.subtotal ?? fallbackSubtotal ?? 0);
      return {
        name: item?.product?.name || item?.name || 'Item',
        quantity: Number.isFinite(qty) ? qty : 0,
        subtotal: Number.isFinite(subtotal) ? subtotal : 0,
      };
    });
  }

  async sendOrderConfirmation({ order }) {
    if (!order?.user?.email) {
      return { sent: false, reason: 'missing-recipient' };
    }

    const transport = this.transporter();
    if (!transport) {
      return { sent: false, reason: 'email-not-configured' };
    }

    const orderNumber = order.orderNumber || order.id;
    const currency = safeCurrency(order.currency);
    const total = formatCurrency(order.totalAmount, currency);
    const paymentMethod = String(order.paymentMethod || '').toUpperCase();
    const paymentStatus = String(order.paymentStatus || '').toUpperCase();
    const vendorName = order?.bakery?.name || order?.restaurant?.name || 'Khubzati';
    const customerName = order?.user?.fullName || order?.user?.username || 'Customer';
    const items = this.normalizeItems(order);

    const subject = `Order Confirmed #${orderNumber}`;

    const htmlItems = items
      .map(
        (item) =>
          `<li>${item.name} x${item.quantity} - ${formatCurrency(item.subtotal, currency)}</li>`,
      )
      .join('');

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">
        <h2 style="margin-bottom:8px;">Thank you for your order, ${customerName}</h2>
        <p>Your order <strong>#${orderNumber}</strong> has been received.</p>
        <p><strong>Vendor:</strong> ${vendorName}</p>
        <p><strong>Total:</strong> ${total}</p>
        <p><strong>Payment Method:</strong> ${paymentMethod}</p>
        <p><strong>Payment Status:</strong> ${paymentStatus}</p>
        <h3 style="margin-bottom:6px;">Items</h3>
        <ul style="padding-left:18px; margin-top:0;">${htmlItems || '<li>No items</li>'}</ul>
        <p style="margin-top:20px;">Khubzati Team</p>
      </div>
    `;

    const textLines = [
      `Thank you for your order, ${customerName}`,
      `Order: #${orderNumber}`,
      `Vendor: ${vendorName}`,
      `Total: ${total}`,
      `Payment Method: ${paymentMethod}`,
      `Payment Status: ${paymentStatus}`,
      'Items:',
      ...items.map(
        (item) => `- ${item.name} x${item.quantity} - ${formatCurrency(item.subtotal, currency)}`,
      ),
      'Khubzati Team',
    ];

    await transport.sendMail({
      from: `${this.fromName} <${this.fromEmail}>`,
      to: order.user.email,
      subject,
      text: textLines.join('\n'),
      html,
    });

    return { sent: true };
  }

  async sendOrderCompleted({ order }) {
    if (!order?.user?.email) {
      return { sent: false, reason: 'missing-recipient' };
    }

    const transport = this.transporter();
    if (!transport) {
      return { sent: false, reason: 'email-not-configured' };
    }

    const orderNumber = order.orderNumber || order.id;
    const currency = safeCurrency(order.currency);
    const total = formatCurrency(order.totalAmount, currency);
    const vendorName = order?.bakery?.name || order?.restaurant?.name || 'Khubzati';
    const customerName = order?.user?.fullName || order?.user?.username || 'Customer';
    const subject = `Order Completed #${orderNumber}`;

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">
        <h2 style="margin-bottom:8px;">Order completed, ${customerName}</h2>
        <p>Your order <strong>#${orderNumber}</strong> has been marked as completed.</p>
        <p><strong>Vendor:</strong> ${vendorName}</p>
        <p><strong>Total:</strong> ${total}</p>
        <p style="margin-top:20px;">Thank you for choosing Khubzati.</p>
      </div>
    `;

    const text = [
      `Order completed, ${customerName}`,
      `Order: #${orderNumber}`,
      `Vendor: ${vendorName}`,
      `Total: ${total}`,
      'Thank you for choosing Khubzati.',
    ].join('\n');

    await transport.sendMail({
      from: `${this.fromName} <${this.fromEmail}>`,
      to: order.user.email,
      subject,
      text,
      html,
    });

    return { sent: true };
  }

  async sendOrderCancelledToRecipient({
    order,
    recipientEmail,
    recipientName,
    cancelledByName,
    cancellationReason,
  }) {
    const toEmail = String(recipientEmail || '').trim();
    if (!toEmail) {
      return { sent: false, reason: 'missing-recipient' };
    }

    const transport = this.transporter();
    if (!transport) {
      return { sent: false, reason: 'email-not-configured' };
    }

    const orderNumber = order?.orderNumber || order?.id || '-';
    const currency = safeCurrency(order?.currency);
    const total = formatCurrency(order?.totalAmount, currency);
    const recipient =
      String(recipientName || '').trim() || 'Restaurant Partner';
    const bakeryName = cancelledByName || order?.bakery?.name || 'Bakery';
    const reasonText = String(cancellationReason || '').trim();
    const subject = `Order Cancelled #${orderNumber}`;

    const reasonHtml = reasonText
      ? `<p><strong>Reason:</strong> ${reasonText}</p>`
      : '';
    const reasonPlain = reasonText ? `Reason: ${reasonText}\n` : '';

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">
        <h2 style="margin-bottom:8px;">Hello ${recipient},</h2>
        <p>Your order <strong>#${orderNumber}</strong> has been cancelled by <strong>${bakeryName}</strong>.</p>
        <p><strong>Total:</strong> ${total}</p>
        ${reasonHtml}
        <p style="margin-top:20px;">Please review your pending orders in the app.</p>
        <p>Khubzati Team</p>
      </div>
    `;

    const text = [
      `Hello ${recipient},`,
      `Order #${orderNumber} has been cancelled by ${bakeryName}.`,
      `Total: ${total}`,
      `${reasonPlain}Please review your pending orders in the app.`,
      'Khubzati Team',
    ].join('\n');

    await transport.sendMail({
      from: `${this.fromName} <${this.fromEmail}>`,
      to: toEmail,
      subject,
      text,
      html,
    });

    return { sent: true };
  }
}

const orderEmailService = new OrderEmailService();

module.exports = {
  OrderEmailService,
  orderEmailService,
};
