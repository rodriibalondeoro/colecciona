/* ==========================================================================
   CARD IDENTIFIER — OCR + Parser + Fuzzy Match
   Analiza una imagen de carta y la identifica automáticamente contra el
   catálogo de colecciones.
   ========================================================================== */

import { categoryKeywords, playerNames, teamNames } from '@/data/cardKeywords';
import { collections } from '@/data/collections';

let worker = null;

/**
 * Extrae texto de una imagen usando Tesseract.js (OCR en navegador).
 * Devuelve el texto crudo detectado.
 */
export async function extractTextFromImage(imageUrl) {
  if (typeof window === 'undefined') return '';

  const { createWorker } = await import('tesseract.js');

  if (!worker) {
    worker = await createWorker('eng+spa', 1, {
      logger: () => {},
    });
  }

  const { data } = await worker.recognize(imageUrl);
  return data.text || '';
}

/**
 * Parser que extrae metadatos de una carta a partir del texto OCR.
 * Devuelve: { title, category, set, year, code, player, team, language, confidence }
 */
export function parseCardText(rawText) {
  if (!rawText || !rawText.trim()) {
    return { rawText: '', parsed: null };
  }

  const text = rawText
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s\d]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const result = {
    rawText: rawText.trim(),
    title: extractTitle(rawText),
    year: extractYear(text),
    code: extractCode(rawText),
    player: extractPlayer(text),
    team: extractTeam(text),
    language: detectLanguage(rawText),
    set: extractSet(text),
    number: extractNumber(text),
  };

  return result;
}

function extractTitle(rawText) {
  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
  // Typically the card name is one of the first non-empty, short lines
  for (const line of lines) {
    if (line.length >= 3 && line.length <= 60 && !/^\d+$/.test(line)) {
      return line;
    }
  }
  return lines[0] || '';
}

function extractYear(text) {
  const match = text.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  return match ? parseInt(match[1], 10) : new Date().getFullYear();
}

function extractCode(rawText) {
  // Common card code patterns: BS-004, PKM-042, LOB-001, etc.
  const match = rawText.match(/\b([A-Z]{1,4}-\d{1,4})\b/i);
  return match ? match[1].toUpperCase() : null;
}

function extractPlayer(text) {
  let bestMatch = null;
  let bestScore = 0;

  for (const name of playerNames) {
    const nameLower = name.toLowerCase();
    const score = fuzzyScore(text, nameLower);
    if (score > bestScore && score > 0.6) {
      bestScore = score;
      bestMatch = name;
    }
  }

  return bestMatch;
}

function extractTeam(text) {
  let bestMatch = null;
  let bestScore = 0;

  for (const team of teamNames) {
    const teamLower = team.toLowerCase();
    const score = fuzzyScore(text, teamLower);
    if (score > bestScore && score > 0.6) {
      bestScore = score;
      bestMatch = team;
    }
  }

  return bestMatch;
}

function extractSet(text) {
  const setPatterns = [
    'base set', 'crown zenith', 'evolving skies', 'brilliant stars',
    'match attax', 'prizm', 'donruss', 'chrome', 'topps', 'panini',
    'adrenalyn', 'megacracks', 'obsidian', 'heritage', 'pristine',
    'stadium club', 'score', 'turbo attax', 'ucc', 'collector',
    'euroleague', 'motif', 'flagship', 'bundesliga gold',
    'laliga', 'premier league', 'champions league',
    'marvel verse', 'dc heritage', 'star wars galaxy',
    'berserk', 'principito', 'digital collections',
  ];

  for (const set of setPatterns) {
    if (text.includes(set)) {
      // Capitalize first letter of each word
      return set
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
  }
  return null;
}

function extractNumber(text) {
  const match = text.match(/\b(?:no\.?|#|nº)\s*(\d{1,4})\b/i);
  return match ? match[1] : null;
}

function detectLanguage(rawText) {
  const lower = rawText.toLowerCase();
  const spanishWords = ['el', 'la', 'los', 'las', 'de', 'del', 'en', 'con', 'por', 'para', 'jugador', 'equipo', 'selección'];
  const japaneseChars = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/;

  if (japaneseChars.test(rawText)) return 'Japonés';

  let spanishCount = 0;
  for (const word of spanishWords) {
    if (lower.includes(word)) spanishCount++;
  }

  return spanishCount >= 2 ? 'Español' : 'Inglés';
}

/* ---------- MATCHING ---------- */

/**
 * Hace match del texto parseado contra las keywords del catálogo.
 * Devuelve un array de categorías ordenadas por confianza.
 */
export function matchAgainstCatalog(parsed) {
  if (!parsed) return [];

  const text = (
    (parsed.rawText || '') + ' ' +
    (parsed.title || '') + ' ' +
    (parsed.player || '') + ' ' +
    (parsed.team || '') + ' ' +
    (parsed.set || '')
  )
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const scores = [];

  for (const [categoryId, keywords] of Object.entries(categoryKeywords)) {
    let score = 0;

    for (const keyword of keywords) {
      const kw = keyword
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      if (text.includes(kw)) {
        // Longer keyword matches are worth more
        score += kw.length * 2;
      }
    }

    // Bonus: if player/team is found and category is sport-related
    if (parsed.player && ['mundial', 'tlg-futbol', 'champions', 'baloncesto', 'beisbol', 'nfl-ufc', 'motor'].some(
      (s) => {
        const section = collections.find((c) => c.id === s);
        return section?.subs?.some((sub) => sub.id === categoryId);
      }
    )) {
      score += 10;
    }

    if (parsed.team && ['mundial', 'tlg-futbol', 'champions'].some(
      (s) => {
        const section = collections.find((c) => c.id === s);
        return section?.subs?.some((sub) => sub.id === categoryId);
      }
    )) {
      score += 5;
    }

    if (score > 0) {
      scores.push({ categoryId, score });
    }
  }

  scores.sort((a, b) => b.score - a.score);

  // Calculate confidence as percentage (0-100)
  const maxPossibleScore = 50;
  return scores.slice(0, 5).map((s) => {
    const confidence = Math.min(100, Math.round((s.score / maxPossibleScore) * 100));
    const category = findCategoryById(s.categoryId);
    return {
      categoryId: s.categoryId,
      sectionId: category?.sectionId || null,
      sectionName: category?.sectionName || '',
      categoryName: category?.categoryName || s.categoryId,
      confidence,
    };
  });
}

function findCategoryById(categoryId) {
  for (const section of collections) {
    const sub = section.subs?.find((s) => s.id === categoryId);
    if (sub) {
      return {
        sectionId: section.id,
        sectionName: section.name,
        categoryName: sub.name,
      };
    }
  }
  return null;
}

/* ---------- FUZZY MATCHING ---------- */

function fuzzyScore(text, target) {
  if (!text || !target) return 0;
  if (text.includes(target)) return 1;

  const textWords = text.split(' ');
  const targetWords = target.split(' ');

  let matchedWords = 0;
  for (const tw of targetWords) {
    for (const word of textWords) {
      if (word === tw || levenshtein(word, tw) <= Math.max(1, Math.floor(tw.length * 0.3))) {
        matchedWords++;
        break;
      }
    }
  }

  return matchedWords / targetWords.length;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

/**
 * Función principal: analiza una imagen y devuelve identificación completa.
 */
export async function identifyCard(imageUrl) {
  const rawText = await extractTextFromImage(imageUrl);
  const parsed = parseCardText(rawText);
  const matches = matchAgainstCatalog(parsed);

  const bestMatch = matches.length > 0 ? matches[0] : null;

  return {
    rawText: parsed.rawText,
    title: parsed.title || '',
    player: parsed.player || '',
    team: parsed.team || '',
    year: parsed.year,
    code: parsed.code || parsed.number || null,
    set: parsed.set || '',
    language: parsed.language || 'Español',
    category: bestMatch?.categoryId || null,
    sectionId: bestMatch?.sectionId || null,
    confidence: bestMatch?.confidence || 0,
    matches,
  };
}
