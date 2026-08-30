"use client";

import { useState, useEffect, useCallback } from "react";
import { identifyCard, matchAgainstCatalog, parseCardText } from "@/lib/cardIdentifier";
import { collections } from "@/data/collections";
import styles from "./CardIdentifier.module.css";

const IDENTIFY_STEPS = [
  { label: "Analizando imagen..." },
  { label: "Extrayendo texto de la carta..." },
  { label: "Identificando colección..." },
];

export default function CardIdentifier({ imageUrl, onIdentify, onSkip }) {
  const [phase, setPhase] = useState("loading"); // loading | result | search | error
  const [stepIndex, setStepIndex] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);

  const startIdentification = useCallback(async () => {
    if (!imageUrl) return;

    setPhase("loading");
    setStepIndex(0);
    setError(null);

    const tick = setInterval(() => {
      setStepIndex((prev) => {
        if (prev < IDENTIFY_STEPS.length - 1) return prev + 1;
        return prev;
      });
    }, 800);

    try {
      const identified = await identifyCard(imageUrl);
      clearInterval(tick);
      setResult(identified);

      if (identified.confidence >= 30) {
        setPhase("result");
      } else {
        setPhase("search");
      }
    } catch (err) {
      clearInterval(tick);
      console.error("[CardIdentifier] Error:", err);
      setError(err?.message || "No se pudo analizar la imagen");
      setPhase("error");
    }
  }, [imageUrl]);

  useEffect(() => {
    startIdentification();
  }, [startIdentification]);

  const handleUseResult = () => {
    if (result && onIdentify) {
      onIdentify({
        title: result.title || "",
        category: result.category || "",
        set: result.set || "",
        year: result.year || new Date().getFullYear(),
        code: result.code || "",
        language: result.language || "Español",
        player: result.player || "",
        team: result.team || "",
      });
    }
  };

  const handleSearch = (query) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }

    const parsed = parseCardText(query);
    const matches = matchAgainstCatalog(parsed);
    setSuggestions(matches);
  };

  const handleSelectSuggestion = (match) => {
    if (onIdentify) {
      onIdentify({
        title: searchQuery || "",
        category: match.categoryId || "",
        set: "",
        year: new Date().getFullYear(),
        code: "",
        language: "Español",
      });
    }
  };

  const confidenceClass = (val) => {
    if (val >= 60) return "high";
    if (val >= 30) return "medium";
    return "low";
  };

  // Loading state
  if (phase === "loading") {
    return (
      <div className={styles.overlay}>
        <div className={styles.loaderPanel}>
          <div className={styles.spinnerRing} />
          <div className={styles.loadingText}>Identificando carta...</div>
          <div className={styles.loadingSubtext}>
            {IDENTIFY_STEPS[stepIndex]?.label || "Procesando..."}
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (phase === "error") {
    return (
      <div className={styles.overlay}>
        <div className={styles.errorBox}>
          {error}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className={styles.retryBtn} onClick={startIdentification}>
              Reintentar
            </button>
            <button className={styles.manualBtn} onClick={onSkip}>
              Buscar manualmente
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Result with confidence
  if (phase === "result" && result) {
    const confClass = confidenceClass(result.confidence);

    return (
      <div className={styles.overlay}>
        <div className={styles.header}>
          <div className={styles.badge}>IDENTIFICACIÓN AUTOMÁTICA</div>
          <h4 className={styles.title}>Carta Identificada</h4>
        </div>

        <div className={styles.resultsBox}>
          <div className={styles.confidenceRow}>
            <div className={styles.confidenceBar}>
              <div
                className={`${styles.confidenceFill} ${styles[confClass]}`}
                style={{ width: `${result.confidence}%` }}
              />
            </div>
            <span className={`${styles.confidenceLabel} ${styles[confClass]}`}>
              {result.confidence}%
            </span>
          </div>

          <div className={styles.metaGrid}>
            {result.title && (
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Título</span>
                <span className={styles.metaValue}>{result.title}</span>
              </div>
            )}
            {result.player && (
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Jugador</span>
                <span className={styles.metaValue}>{result.player}</span>
              </div>
            )}
            {result.team && (
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Equipo</span>
                <span className={styles.metaValue}>{result.team}</span>
              </div>
            )}
            {result.set && (
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Set / Edición</span>
                <span className={styles.metaValue}>{result.set}</span>
              </div>
            )}
            {result.year && (
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Año</span>
                <span className={styles.metaValue}>{result.year}</span>
              </div>
            )}
            {result.code && (
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Código</span>
                <span className={styles.metaValue}>{result.code}</span>
              </div>
            )}
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Idioma</span>
              <span className={styles.metaValue}>{result.language}</span>
            </div>
          </div>

          {result.category && (
            <span className={styles.categoryBadge}>
              {getCategoryName(result.category)}
            </span>
          )}
        </div>

        <div className={styles.actions}>
          <button className={styles.useBtn} onClick={handleUseResult}>
            Usar esta identificación +
          </button>
          <button className={styles.manualBtn} onClick={() => setPhase("search")}>
            No es correcto
          </button>
        </div>
      </div>
    );
  }

  // Search fallback
  return (
    <div className={styles.overlay}>
      <div className={styles.header}>
        <div className={styles.badge}>BÚSQUEDA MANUAL</div>
        <h4 className={styles.title}>Busca tu carta</h4>
        <p>Escribe el nombre del jugador, equipo o carta para encontrarla en el catálogo.</p>
      </div>

      <div className={styles.searchFallback}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Ej. Vinicius LaLiga 26-27, Charizard Base Set..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          autoFocus
        />

        {suggestions.length > 0 && (
          <div className={styles.suggestions}>
            {suggestions.map((match) => {
              const confClass = confidenceClass(match.confidence);
              return (
                <button
                  key={match.categoryId}
                  className={styles.suggestionItem}
                  onClick={() => handleSelectSuggestion(match)}
                >
                  <div>
                    <div className={styles.suggestionName}>
                      {getCategoryName(match.categoryId)}
                    </div>
                    <div className={styles.suggestionSection}>
                      {match.sectionName}
                    </div>
                  </div>
                  <span
                    className={`${styles.suggestionConfidence} ${styles[confClass]}`}
                  >
                    {match.confidence}%
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className={styles.actions}>
          <button className={styles.manualBtn} onClick={onSkip}>
            Omitir y rellenar manualmente
          </button>
        </div>
      </div>
    </div>
  );
}

function getCategoryName(categoryId) {
  for (const section of collections) {
    const sub = section.subs?.find((s) => s.id === categoryId);
    if (sub) return sub.name;
  }
  return categoryId;
}
