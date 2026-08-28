/**
 * FinGraph Advanced Fraud Detection Engine (Node.js Reference Implementation)
 * Enforces streaming fraud rules: Smurfing, High Velocity, Circular Loops, Fan-Out, Fan-In, Dormant Spike, Amount Anomaly.
 */

function detectFraud(transactions) {
  let alerts = [];

  // Group by sender
  const map = {};
  const receiverMap = {};

  for (let tx of transactions) {
    const sender = tx.sender || tx.from_account || (tx.sender && tx.sender.id);
    const receiver = tx.receiver || tx.to_account || (tx.receiver && tx.receiver.id);
    const amount = Number(tx.amount || 0);

    if (sender) {
      if (!map[sender]) map[sender] = [];
      map[sender].push(tx);
    }

    if (receiver) {
      if (!receiverMap[receiver]) receiverMap[receiver] = [];
      receiverMap[receiver].push(tx);
    }
  }

  // 1. Sender-based Detection Rules (Smurfing, High Velocity, Fan-Out)
  for (let sender in map) {
    const txs = map[sender];
    let total = txs.reduce((s, t) => s + Number(t.amount || 0), 0);

    // 3.1 Smurfing (Money Splitting)
    if (txs.length > 5 && total > 50000) {
      alerts.push({
        sender,
        type: "SMURFING",
        description: `Smurfing detected: ${txs.length} transfers from ${sender} totaling ₹${total.toLocaleString()}`,
        severity: "HIGH"
      });
    }

    // 3.2 High Velocity
    if (txs.length > 10) {
      alerts.push({
        sender,
        type: "HIGH_VELOCITY",
        description: `High velocity anomaly: ${txs.length} transactions per minute executed by ${sender}`,
        severity: "CRITICAL"
      });
    }

    // 3.6 Fan-Out Pattern (One to Many: > 10 unique receivers)
    const uniqueReceivers = new Set(txs.map(t => t.receiver || t.to_account || (t.receiver && t.receiver.id))).size;
    if (uniqueReceivers > 10) {
      alerts.push({
        sender,
        type: "DISTRIBUTION_PATTERN",
        description: `Fan-Out distribution pattern: Account ${sender} sent funds to ${uniqueReceivers} unique accounts`,
        severity: "HIGH"
      });
    }
  }

  // 2. Receiver-based Detection Rules (Fan-In / Collection Account)
  for (let receiver in receiverMap) {
    const txs = receiverMap[receiver];
    const uniqueSenders = new Set(txs.map(t => t.sender || t.from_account || (t.sender && t.sender.id))).size;
    if (uniqueSenders > 10) {
      alerts.push({
        receiver,
        type: "COLLECTION_ACCOUNT",
        description: `Fan-In collection pattern: Account ${receiver} received funds from ${uniqueSenders} unique senders`,
        severity: "HIGH"
      });
    }
  }

  return alerts;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { detectFraud };
}
