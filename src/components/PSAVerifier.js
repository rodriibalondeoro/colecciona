"use client";

import { useState, useRef, useEffect } from "react";
import styles from "./PSAVerifier.module.css";

// Base de datos de certificados PSA mock válidos para simulación oficial
const PSA_DATABASE = {
  "98765432": {
    title: "Charizard Holo 1ª Edición",
    set: "Base Set (1999)",
    year: 1999,
    category: "liga-este-26-27",
    condition: "PSA10",
    code: "BS-004",
    rarity: "Holo Secret",
    language: "Español",
    grade: "PSA 10 Gem Mint",
    certUrl: "https://www.psacard.com/cert/98765432",
  },
  "12345678": {
    title: "Black Lotus",
    set: "Alpha Edition (1993)",
    year: 1993,
    category: "champions-stickers-26-27",
    code: "AL-001",
    rarity: "Rare",
    language: "Inglés",
    grade: "PSA 9 Mint",
    certUrl: "https://www.psacard.com/cert/12345678",
  },
  "55551234": {
    title: "Blue-Eyes White Dragon",
    set: "Legend of Blue Eyes (2002)",
    year: 2002,
    category: "prizm-nba",
    code: "LOB-001",
    rarity: "Ultra Rare",
    language: "Español",
    grade: "PSA 9 Mint",
    certUrl: "https://www.psacard.com/cert/55551234",
  },
};

// Etapas que simulan la consulta oficial a la base de datos de PSA
const VERIFY_STEPS = [
  { label: "Autenticando certificado..." },
  { label: "Consultando base de datos oficial de PSA..." },
  { label: "Cargando metadatos de la carta..." },
];

export default function PSAVerifier({ onVerify }) {
  const [certNumber, setCertNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const handleVerify = () => {
    if (!certNumber.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setStepIndex(0);

    let i = 0;
    intervalRef.current = setInterval(() => {
      i += 1;
      if (i < VERIFY_STEPS.length) {
        setStepIndex(i);
      } else {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
        const data = PSA_DATABASE[certNumber.trim()];
        setLoading(false);
        if (data) {
          setResult(data);
          if (onVerify) onVerify({ ...data, cert: certNumber.trim() });
        } else {
          setError("Certificado no encontrado. Prueba: 98765432, 12345678 o 55551234.");
        }
      }
    }, 700);
  };

  const applyToForm = () => {
    if (result && onVerify) {
      onVerify({ ...result, cert: certNumber.trim() });
      setResult(null);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.psaBadge}>PSA AUTHENTICATION</div>
        <h4 className={styles.psaTitle}>Verificación de Certificado PSA</h4>
        <p>Introduce el código de 8 dígitos de la etiqueta de gradación. La app cargará automáticamente los datos oficiales de la carta.</p>
      </div>

      <div className={styles.inputRow}>
        <input
          type="text"
          maxLength={8}
          className={styles.input}
          placeholder="Ej. 98765432"
          value={certNumber}
          onChange={(e) => setCertNumber(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && handleVerify()}
        />
        <button
          type="button"
          className={styles.verifyBtn}
          onClick={handleVerify}
          disabled={loading || certNumber.length < 8}
        >
          {loading ? "Verificando..." : "Validar"}
        </button>
      </div>

      {loading && (
        <div className={styles.loaderPanel}>
          <div className={styles.spinnerRing} />
          <div className={styles.steps}>
            {VERIFY_STEPS.map((s, idx) => (
              <div
                key={s.label}
                className={`${styles.step} ${
                  idx < stepIndex
                    ? styles.done
                    : idx === stepIndex
                    ? styles.active
                    : ""
                }`}
              >
                <span className={styles.stepIcon}>
                  {idx < stepIndex ? "✓" : idx === stepIndex ? "●" : "○"}
                </span>
                <span className={styles.stepLabel}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <div className={styles.errorBox}>{error}</div>}

      {result && (
        <div className={styles.successBox}>
          <div className={styles.successHeader}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>Certificado Verificado por PSA</span>
          </div>
          <div className={styles.metaGrid}>
            <div>
              <span className={styles.label}>Carta:</span>
              <span className={styles.value}>{result.title}</span>
            </div>
            <div>
              <span className={styles.label}>Colección/Set:</span>
              <span className={styles.value}>{result.set}</span>
            </div>
            <div>
              <span className={styles.label}>Gradación:</span>
              <span className={styles.gradeBadge}>{result.grade}</span>
            </div>
            <div>
              <span className={styles.label}>Año / Idioma:</span>
              <span className={styles.value}>{result.year} • {result.language}</span>
            </div>
          </div>
          <button type="button" className={styles.applyBtn} onClick={applyToForm}>
            Usar estos datos en el anuncio +
          </button>
        </div>
      )}
    </div>
  );
}