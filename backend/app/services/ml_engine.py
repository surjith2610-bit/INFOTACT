import math
import numpy as np
import logging
from typing import Dict, Any, List, Tuple
from datetime import datetime, timezone

logger = logging.getLogger("ml_engine")

try:
    from sklearn.ensemble import IsolationForest, RandomForestClassifier
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    logger.warning("[ML ENGINE] scikit-learn not available. Falling back to heuristic anomaly scoring.")


class FraudMLEngine:
    """
    AI-Powered Fraud Detection & Explainable AI (XAI) Engine.
    Combines Isolation Forest Anomaly Detection + Random Forest Classifier + Graph Topology & Time Clustering Metrics.
    """

    def __init__(self):
        self.iso_forest = IsolationForest(n_estimators=120, contamination=0.08, random_state=42) if SKLEARN_AVAILABLE else None
        self.rf_classifier = RandomForestClassifier(n_estimators=100, max_depth=6, random_state=42) if SKLEARN_AVAILABLE else None
        self.is_fitted = False
        self._fit_synthetic_baseline()

    def _fit_synthetic_baseline(self):
        """Fits Isolation Forest and Random Forest on synthetic baseline feature matrix."""
        if not SKLEARN_AVAILABLE:
            return

        # 300 normal transactions
        normal_samples = np.random.normal(
            loc=[35000, 2, 2, 1.0, 2.5, 0.05, 1800],
            scale=[20000, 1, 1, 0.3, 1.2, 0.04, 600],
            size=(300, 7)
        )
        normal_samples = np.clip(normal_samples, a_min=[500, 1, 1, 0.01, 1, 0.0, 30], a_max=None)
        y_normal = np.zeros(300)

        # 40 syndicate fraud outliers (smurfing mules, circular wash, large drains)
        fraud_samples = np.array([
            [817550, 12, 1, 8.2, 11, 0.98, 45],
            [819200, 15, 2, 8.3, 14, 0.99, 60],
            [824000, 10, 1, 8.4, 10, 0.97, 30],
            [815000, 14, 3, 8.2, 12, 0.96, 50],
            [6225000, 1, 1, 15.0, 3, 0.10, 120],
            [373500, 8, 8, 4.5, 9, 0.40, 90],
            [365200, 8, 8, 4.3, 8, 0.38, 75],
            [356900, 7, 7, 4.2, 8, 0.35, 60],
            [1245000, 18, 1, 9.0, 15, 0.20, 40],
            [821700, 16, 2, 8.3, 13, 0.98, 55],
        ] * 4)
        y_fraud = np.ones(len(fraud_samples))

        X_train = np.vstack([normal_samples, fraud_samples])
        y_train = np.concatenate([y_normal, y_fraud])

        try:
            self.iso_forest.fit(X_train)
            self.rf_classifier.fit(X_train, y_train)
            self.is_fitted = True
            logger.info("[ML ENGINE] Isolation Forest and Random Forest models trained successfully.")
        except Exception as e:
            logger.warning(f"[ML ENGINE] Model training error: {e}")

    def calculate_smurfing_similarity(self, amount: float) -> float:
        """
        Calculates similarity index (0.0 to 1.0) for structured smurfing patterns
        Targeting ~₹8,00,000–₹8,29,500 INR (SAR threshold ~$10k * 83) or $9,000–$9,990 USD.
        """
        amt = float(amount or 0.0)
        # USD range $9,000 to $9,990
        if 9000.0 <= amt <= 9990.0:
            diff = abs(amt - 9750.0)
            return max(0.0, 1.0 - (diff / 1000.0))

        # INR range ₹8,00,000 to ₹8,29,500
        if 780000.0 <= amt <= 829900.0:
            target = 817550.0  # Common structured smurfing benchmark (~$9,850)
            diff = abs(amt - target)
            return max(0.0, 1.0 - (diff / 50000.0))

        if amt >= 830000.0:
            return 0.2
        return 0.0

    def extract_features(
        self,
        amount: float,
        sender_velocity: int,
        receiver_velocity: int,
        historical_avg: float = 40000.0,
        sender_degree: int = 2,
        receiver_degree: int = 2,
        time_delta_seconds: float = 300.0,
    ) -> np.ndarray:
        """Extracts normalized 7-dimension feature vector for ML scoring."""
        amount_ratio = amount / max(1.0, historical_avg)
        max_degree = max(sender_degree, receiver_degree)
        smurf_sim = self.calculate_smurfing_similarity(amount)
        return np.array([[
            amount,
            sender_velocity,
            receiver_velocity,
            amount_ratio,
            max_degree,
            smurf_sim,
            time_delta_seconds,
        ]])

    def compute_ml_anomaly_score(self, features: np.ndarray) -> Tuple[float, float]:
        """
        Evaluates ensemble Isolation Forest + Random Forest.
        Returns (ml_score_0_to_25, fraud_probability_0_to_1).
        """
        if not SKLEARN_AVAILABLE or not self.is_fitted:
            # Resilient heuristic calculation fallback
            amount = features[0][0]
            velocity = max(features[0][1], features[0][2])
            smurf_sim = features[0][5]
            raw = (amount / 830000.0) * 8 + velocity * 1.5 + smurf_sim * 10.0
            score_25 = min(25.0, max(0.0, raw))
            prob = min(0.99, score_25 / 25.0)
            return round(score_25, 2), round(prob, 3)

        try:
            # 1. Isolation Forest Anomaly Score
            dec_score = float(self.iso_forest.decision_function(features)[0])
            anomaly_intensity = max(0.0, -dec_score + 0.15)
            iso_score = min(25.0, anomaly_intensity * 48.0)

            # 2. Random Forest Probability
            rf_prob = float(self.rf_classifier.predict_proba(features)[0][1])

            # Ensemble combination
            ensemble_score = (iso_score * 0.5) + (rf_prob * 25.0 * 0.5)
            final_prob = round((rf_prob * 0.6) + (min(1.0, iso_score / 25.0) * 0.4), 3)

            return round(min(25.0, ensemble_score), 2), final_prob
        except Exception as e:
            logger.warning(f"[ML ENGINE] Anomaly score evaluation fallback: {e}")
            return 11.5, 0.46

    def evaluate_fraud_risk(
        self,
        amount: float,
        sender_velocity: int = 1,
        receiver_velocity: int = 1,
        sender_degree: int = 1,
        receiver_degree: int = 1,
        historical_avg: float = 37350.0,
        has_shared_ip: bool = False,
        is_circular: bool = False,
        is_smurfing: bool = False,
        time_delta_seconds: float = 300.0,
    ) -> Dict[str, Any]:
        """
        Calculates composite 4-Pillar AML Risk Score:
        Risk Score (0-100) = Velocity (0-25) + Amount/Smurfing (0-25) + Graph Centrality (0-25) + ML Ensemble (0-25).
        Returns unified risk score, fraud probability, risk level, and Explainable AI (XAI) details.
        """
        explanations = []

        # 1. Velocity Score (0 - 25 points)
        max_vel = max(sender_velocity, receiver_velocity)
        if max_vel >= 12:
            vel_score = 25.0
            explanations.append(f"Extreme transaction velocity detected: {max_vel} transfers in timeframe (+25 pts)")
        elif max_vel >= 7:
            vel_score = 18.0
            explanations.append(f"High velocity activity: {max_vel} transfers in timeframe (+18 pts)")
        elif max_vel >= 4:
            vel_score = 11.0
            explanations.append(f"Moderate velocity increase: {max_vel} transfers (+11 pts)")
        else:
            vel_score = min(8.0, max_vel * 2.0)

        # 2. Amount & Smurfing Anomaly Score (0 - 25 points)
        amount_ratio = amount / max(1.0, historical_avg)
        large_thresh = 830000.0  # ₹8.3 Lakhs regulatory limit
        smurf_sim = self.calculate_smurfing_similarity(amount)
        if is_smurfing:
            smurf_sim = max(smurf_sim, 0.95)

        if amount >= large_thresh or amount >= 10000.0 or amount_ratio >= 10.0:
            amount_score = 25.0
            explanations.append(f"Large transaction threshold breached (₹{amount:,.2f}) (+25 pts)")
        elif smurf_sim >= 0.70 or is_smurfing:
            amount_score = round(18.0 + (smurf_sim * 7.0), 1)
            explanations.append(f"Structured Smurfing Pattern: ₹{amount:,.2f} is intentionally clustered just below threshold (+{amount_score} pts)")
        elif amount_ratio >= 5.0:
            amount_score = 20.0
            explanations.append(f"Amount anomaly: ₹{amount:,.2f} is {amount_ratio:.1f}x higher than account baseline (+20 pts)")
        else:
            amount_score = min(14.0, (amount / 83000.0) * 1.5)

        # 3. Graph Centrality & Topology Score (0 - 25 points)
        max_degree = max(sender_degree, receiver_degree)
        graph_score = 0.0
        if is_circular:
            graph_score += 15.0
            explanations.append("Circular transfer topology loop detected (A->B->C->A) (+15 pts)")
        if is_smurfing:
            graph_score += 12.0
            explanations.append("Starburst Smurfing fan-in/fan-out graph pattern (+12 pts)")
        if max_degree >= 10:
            graph_score += 10.0
            explanations.append(f"High graph degree centrality ({max_degree} connected counterparties) (+10 pts)")
        elif max_degree >= 5:
            graph_score += 5.0
            explanations.append(f"Hub account pattern: connected to {max_degree} counterparties (+5 pts)")
        if has_shared_ip:
            graph_score += 8.0
            explanations.append("Shared IP subnet address detected across multiple sender accounts (+8 pts)")
        graph_score = min(25.0, graph_score)

        # 4. ML Ensemble & Time Clustering Score (0 - 25 points)
        features = self.extract_features(
            amount,
            sender_velocity,
            receiver_velocity,
            historical_avg,
            sender_degree,
            receiver_degree,
            time_delta_seconds,
        )
        ml_score, fraud_prob = self.compute_ml_anomaly_score(features)

        if time_delta_seconds <= 60.0 and max_vel >= 3:
            explanations.append(f"High-frequency time clustering: rapid bursts within {time_delta_seconds:.0f}s intervals")

        if ml_score >= 16.0:
            explanations.append(f"AI Ensemble (Isolation Forest + Random Forest) flagged anomalous fraud signature (ML Score: {ml_score}/25)")

        # Unified Composite Risk Score (0 - 100)
        raw_risk_score = vel_score + amount_score + graph_score + ml_score
        risk_score = round(min(100.0, max(0.0, raw_risk_score)), 1)

        # Risk Classification Level
        if risk_score >= 70.0:
            risk_level = "CRITICAL"
        elif risk_score >= 50.0:
            risk_level = "HIGH"
        elif risk_score >= 25.0:
            risk_level = "MEDIUM"
        else:
            risk_level = "LOW"

        if not explanations:
            explanations.append("Transaction behavior consistent with normal verified retail baseline.")

        breakdown = {
            "velocity_score": round(vel_score, 1),
            "amount_score": round(amount_score, 1),
            "amount_similarity_score": round(amount_score, 1),
            "graph_score": round(graph_score, 1),
            "ml_anomaly_score": round(ml_score, 1),
        }

        return {
            "risk_score": risk_score,
            "fraud_probability": fraud_prob,
            "risk_level": risk_level,
            "score_breakdown": breakdown,
            "components": breakdown,
            "explanations": explanations,
            "evaluated_at": datetime.now(timezone.utc).isoformat(),
        }


ml_engine = FraudMLEngine()

