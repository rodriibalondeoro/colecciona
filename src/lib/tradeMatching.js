/**
 * Trade Matching Algorithm
 * Finds compatible traders by comparing what each user has vs what they want.
 */

/**
 * Calculate compatibility score between two users.
 * @param {Object} userA - { wants: [...], offers: [...] }
 * @param {Object} userB - { wants: [...], offers: [...] }
 * @returns {Object} { score, aCanGetFromB, bCanGetFromA }
 */
export function calculateCompatibility(userA, userB) {
  const aWants = new Set((userA.wants || []).map(normalize));
  const aOffers = new Set((userA.offers || []).map(normalize));
  const bWants = new Set((userB.wants || []).map(normalize));
  const bOffers = new Set((userB.offers || []).map(normalize));

  // What A can get from B (B has, A wants)
  const aCanGetFromB = [...aWants].filter(w => bOffers.has(w));
  // What B can get from A (A has, B wants)
  const bCanGetFromA = [...bWants].filter(w => aOffers.has(w));

  const totalPossible = aWants.size + bWants.size || 1;
  const matched = aCanGetFromB.length + bCanGetFromA.length;

  const score = Math.round((matched / totalPossible) * 100);

  return {
    score: Math.min(score, 100),
    aCanGetFromB,
    bCanGetFromA,
    matched,
    totalPossible,
  };
}

/**
 * Find top matches for a user from a pool of other users.
 * @param {Object} targetUser - { id, wants: [...], offers: [...] }
 * @param {Array} otherUsers - [{ id, wants: [...], offers: [...] }]
 * @param {Object} options - { minScore: 10, maxResults: 20 }
 * @returns {Array} sorted matches with compatibility data
 */
export function findMatches(targetUser, otherUsers, options = {}) {
  const { minScore = 10, maxResults = 20 } = options;
  const matches = [];

  for (const other of otherUsers) {
    if (other.id === targetUser.id) continue;

    const result = calculateCompatibility(targetUser, other);

    if (result.score >= minScore && (result.aCanGetFromB.length > 0 || result.bCanGetFromA.length > 0)) {
      matches.push({
        userId: other.id,
        userName: other.name,
        username: other.username,
        avatarUrl: other.avatar_url,
        score: result.score,
        youCanGet: result.aCanGetFromB,
        theyCanGet: result.bCanGetFromA,
        matchedCount: result.matched,
      });
    }
  }

  return matches
    .sort((a, b) => b.score - a.score || b.matchedCount - a.matchedCount)
    .slice(0, maxResults);
}

function normalize(str) {
  return (str || "").toLowerCase().trim();
}
