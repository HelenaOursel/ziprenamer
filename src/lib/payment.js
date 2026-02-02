const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey ? require('stripe')(stripeKey) : {
    checkout: { sessions: { create: () => Promise.reject('Stripe not configured') } }
};
const crypto = require('crypto');

// In-memory store for unlock tokens (mock database)
// Key: token, Value: { expiresAt: number, type: 'premium' }
const activeSessions = new Map();

/**
 * Creates a Stripe Checkout Session
 */
async function createCheckoutSession(successUrl, cancelUrl, priceId) {
    // Determine the Price ID based on environment or hardcoded test ID
    // For MVP we can use a placeholder or create one dynamically if needed, 
    // but usually you'd have a PRICE_ID env var.
    if (!process.env.STRIPE_PRICE_ID) {
        console.warn("STRIPE_PRICE_ID not set. Payments will fail in prod.");
    }

    // For this MVP, we will simulate a session if no key provided or just return mock
    if (!process.env.STRIPE_SECRET_KEY && process.env.NODE_ENV !== 'production') {
        return {
            id: 'mock_session_' + Date.now(),
            url: successUrl + '?session_id=mock_session_123'
        };
    }

    const session = await stripe.checkout.sessions.create({
        // automatic_payment_methods enabled for Google Pay / Apple Pay / PayPal
        automatic_payment_methods: {
            enabled: true,
        },
        line_items: [
            {
                price: priceId || process.env.STRIPE_PRICE_ID, // Use passed ID or default
                quantity: 1,
            },
        ],
        mode: 'payment',
        success_url: successUrl + '?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: cancelUrl,
    });

    return session;
}

/**
 * Verifies a Stripe Session and generating an app token
 */
async function verifySessionAndCreateToken(sessionId) {
    if (sessionId.startsWith('mock_session') && process.env.NODE_ENV !== 'production') {
        const token = crypto.randomBytes(32).toString('hex');
        activeSessions.set(token, { expiresAt: Date.now() + 3600000 }); // 1 hour
        return token;
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === 'paid') {
        const token = crypto.randomBytes(32).toString('hex');
        activeSessions.set(token, { expiresAt: Date.now() + 3600000 }); // 1 hour
        return token;
    }
    return null;
}

/**
 * Checks if a token is valid
 */
function isTokenValid(token) {
    if (!token) return false;
    const session = activeSessions.get(token);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
        activeSessions.delete(token);
        return false;
    }
    return true;
}

module.exports = { createCheckoutSession, verifySessionAndCreateToken, isTokenValid };
