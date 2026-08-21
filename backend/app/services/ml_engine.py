import math
import numpy as np
import logging
from typing import Dict, Any, List, Tuple
from datetime import datetime, timezone

logger = logging.getLogger("ml_engine")

try:
    from sklearn.ensemble import IsolationForest
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    logger.warning("[ML ENGINE] scikit-learn not available. Falling back to heuristic anomaly scoring.")


class FraudMLEngine:
    """
    AI-Powered Fraud Detection & Explainable AI (XAI) Engine.
    Combines Isolation Forest ML model with Graph Centrality and Velocity Metrics.
    """

    def __init__(self):
        self.model = IsolationForest(n_estimators=100, contamination=0.1, random_state=42) if SKLEARN_AVAILABLE else None
        self.is_fitted = False
        self._fit_synthetic_baseline()

    def _fit_synthetic_baseline(self):
        """Fits Isolation Forest model on synthetic baseline feature matrix for immediate readiness."""
        if not SKLEARN_AVAILABLE:
            return

        # Feature vector: [amount, sender_velocity, receiver_velocity, amount_ratio, graph_degree]
        normal_samples = np.random.normal(loc=[500, 2, 2, 1.0, 3], scale=[300, 1, 1, 0.3, 1.5], size=(200, 5))
        normal_samples = np.clip(normal_samples, a_min=0, a_max=None)
        
        # Plant fraud outliers
        fraud_samples = np.array([
            [15000, 15, 1, 8.5, 12],
            [9800, 22, 18, 5.2, 15],
            [48000, 1, 1, 15.0, 2],
            [9900, 12, 12, 4.0, 10],
            [12000, 18, 2, 7.0, 14],
        ])
        
        X_train = np.vstack([normal_samples, fraud_samples])
        try:
            self.model.fit(X_train)
            self.is_fitted = True
            logger.info("[ML ENGINE] Isolation Forest model fitted successfully.")
        except Exception as e:
            logger.warning(f"[ML ENGINE] Model fitting error: {e}")

    def extract_features(
        self,
        amount: float,
        sender_velocity: int,
        receiver_velocity: int,
        historical_avg: float = 500.0,
        sender_degree: int = 2,
        receiver_degree: int = 2,
    ) -> np.ndarray:
        """Extracts normalized feature vector for ML scoring."""
        amount_ratio = amount / max(1.0, historical_avg)
        max_degree = max(sender_degree, receiver_degree)
        return np.array([[amount, sender_velocity, receiver_velocity, amount_ratio, max_degree]])

    def compute_ml_anomaly_score(self, features: np.ndarray) -> Tuple[float, float]:
        """
        Returns (ml_score_0_to_25, fraud_probability_0_to_1).
        """
        if not SKLEARN_AVAILABLE or not self.is_fitted:
            # Fallback heuristic calculation if sklearn is not installed
            amount = features[0][0]
            velocity = max(features[0][1], features[0][2])
            ratio = features[0][3]
            raw = (amount / 10000.0) * 10 + velocity * 1.5 + ratio * 2.0
            score_25 = min(25.0, raw)
            prob = min(0.99, score_25 / 25.0)
            return score_25, prob

        try:
            # decision_function returns negative values for anomalies, positive for normal
            dec_score = float(self.model.decision_function(features)[0])
            # Normalize decision_score to 0..25 range (lower dec_score = higher anomaly)
            # dec_score usually ranges between -0.3 (extreme outlier) and +0.2 (very normal)
            anomaly_intensity = max(0.0, -dec_score + 0.15)
            ml_score = min(25.0, anomaly_intensity * 50.0)
            
            # Sigmoid transformation for fraud probability (0 to 1)
            prob = 1.0 / (1.0 + math.exp(- (ml_score - 10.0) / 3.0))
            return round(ml_score, 2), round(prob, 3)
        except Exception as e:
            logger.warning(f"[ML ENGINE] Anomaly score evaluation fallback: {e}")
            return 10.0, 0.45

    def evaluate_fraud_risk(
        self,
        amount: float,
        sender_velocity: int = 1,
        receiver_velocity: int = 1,
        sender_degree: int = 1,
        receiver_degree: int = 1,
        historical_avg: float = 450.0,
        has_shared_ip: bool = False,
        is_circular: bool = False,
    ) -> Dict[str, Any]:
        """
        Calculates composite Fraud Score = velocity + amount anomaly + graph centrality + ML anomaly score.
        Returns unified risk score (0-100), fraud probability, risk level, and Explainable AI (XAI) details.
        """
        explanations = []

        # 1. Velocity Score (0 - 25 points)
        max_vel = max(sender_velocity, receiver_velocity)
        if max_vel >= 15:
            vel_score = 25.0
            explanations.append(f"Extreme transaction velocity detected: {max_vel} transfers in timeframe (+25 pts)")
        elif max_vel >= 8:
            vel_score = 18.0
            explanations.append(f"High velocity activity: {max_vel} transfers in window (+18 pts)")
        elif max_vel >= 4:
            vel_score = 10.0
            explanations.append(f"Moderate velocity increase: {max_vel} transfers (+10 pts)")
        else:
            vel_score = max_vel * 2.0

        # 2. Amount Anomaly Score (0 - 25 points)
        amount_ratio = amount / max(1.0, historical_avg)
        if amount >= 10000.0:
            amount_score = 25.0
            explanations.append(f"Large transaction threshold breached (${amount:,.2f} >= $10,000) (+25 pts)")
        elif amount_ratio >= 5.0:
            amount_score = 20.0
            explanations.append(f"Amount anomaly: ${amount:,.2f} is {amount_ratio:.1f}x higher than baseline (+20 pts)")
        elif amount >= 9000.0 and amount < 10000.0:
            amount_score = 22.0
            explanations.append(f"Smurfing amount pattern detected (${amount:,.2f} just under $10,000 limit) (+22 pts)")
        else:
            amount_score = min(15.0, (amount / 1000.0) * 1.5)

        # 3. Graph Centrality & Topology Score (0 - 25 points)
        max_degree = max(sender_degree, receiver_degree)
        graph_score = 0.0
        if is_circular:
            graph_score += 15.0
            explanations.append("Circular transfer topology loop detected (A->B->C->A) (+15 pts)")
        if max_degree >= 10:
            graph_score += 10.0
            explanations.append(f"High graph degree centrality ({max_degree} connected accounts) (+10 pts)")
        elif max_degree >= 5:
            graph_score += 5.0
            explanations.append(f"Hub account pattern: connected to {max_degree} counterparties (+5 pts)")
        if has_shared_ip:
            graph_score += 8.0
            explanations.append("Shared IP address detected across multiple accounts (+8 pts)")
        graph_score = min(25.0, graph_score)

        # 4. ML Anomaly Score (0 - 25 points)
        features = self.extract_features(amount, sender_velocity, receiver_velocity, historical_avg, sender_degree, receiver_degree)
        ml_score, fraud_prob = self.compute_ml_anomaly_score(features)
        
        if ml_score >= 18.0:
            explanations.append(f"Isolation Forest ML model flagged structural anomaly (ML Score: {ml_score}/25) (+{ml_score:.0f} pts)")

        # Unified Composite Risk Score (0 - 100)
        raw_risk_score = vel_score + amount_score + graph_score + ml_score
        risk_score = round(min(100.0, max(0.0, raw_risk_score)), 1)

        # Risk Classification
        if risk_score >= 75.0:
            risk_level = "CRITICAL"
        elif risk_score >= 50.0:
            risk_level = "HIGH"
        elif risk_score >= 25.0:
            risk_level = "MEDIUM"
        else:
            risk_level = "LOW"

        if not explanations:
            explanations.append("Transaction behavior consistent with normal baseline profile.")

        return {
            "risk_score": risk_score,
            "fraud_probability": fraud_prob,
            "risk_level": risk_level,
            "score_breakdown": {
                "velocity_score": round(vel_score, 1),
                "amount_score": round(amount_score, 1),
                "graph_score": round(graph_score, 1),
                "ml_anomaly_score": round(ml_score, 1),
            },
            "explanations": explanations,
            "evaluated_at": datetime.now(timezone.utc).isoformat(),
        }


ml_engine = FraudMLEngine()
