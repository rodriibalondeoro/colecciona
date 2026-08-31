/**
 * Trade Matching Algorithm
 * Finds compatible traders by comparing what each user has vs what they want.
 * Includes reputation and proximity scoring.
 */

/**
 * Calculate compatibility score between two users.
 * @param {Object} userA - { wants: [...], offers: [...] }
 * @param {Object} userB - { wants: [...], offers: [...] }
 * @returns {Object} { cardScore, aCanGetFromB, bCanGetFromA }
 */
export function calculateCompatibility(userA, userB) {
  const aWants = new Set((userA.wants || []).map(normalize));
  const aOffers = new Set((userA.offers || []).map(normalize));
  const bWants = new Set((userB.wants || []).map(normalize));
  const bOffers = new Set((userB.offers || []).map(normalize));

  const aCanGetFromB = [...aWants].filter(w => bOffers.has(w));
  const bCanGetFromA = [...bWants].filter(w => aOffers.has(w));

  const totalPossible = aWants.size + bWants.size || 1;
  const matched = aCanGetFromB.length + bCanGetFromA.length;

  const cardScore = Math.round((matched / totalPossible) * 100);

  return {
    cardScore: Math.min(cardScore, 100),
    aCanGetFromB,
    bCanGetFromA,
    matched,
    totalPossible,
  };
}

/**
 * Calculate final score combining card compatibility, reputation, and distance.
 * @param {Object} params
 * @returns {Object} { finalScore, breakdown }
 */
export function calculateFinalScore({ cardScore, reputation = 0, sameProvince = false, sameCity = false }) {
  const repBonus = Math.min((reputation / 5) * 10, 10);
  const distBonus = sameCity ? 10 : sameProvince ? 5 : 0;
  const finalScore = Math.round(cardScore * 0.8 + repBonus + distBonus);
  return Math.min(finalScore, 100);
}

/**
 * Find top matches for a user from a pool of other users.
 * @param {Object} targetUser - { id, wants: [...], offers: [...] }
 * @param {Array} otherUsers - [{ id, wants: [...], offers: [...], rating, location }]
 * @param {Object} options - { minScore: 10, maxResults: 20, userLocation: "Madrid" }
 * @returns {Array} sorted matches with compatibility data
 */
export function findMatches(targetUser, otherUsers, options = {}) {
  const { minScore = 10, maxResults = 20, userLocation = "" } = options;
  const matches = [];

  for (const other of otherUsers) {
    if (other.id === targetUser.id) continue;

    const { cardScore, aCanGetFromB, bCanGetFromA, matched } = calculateCompatibility(targetUser, other);

    if (cardScore >= minScore && (aCanGetFromB.length > 0 || bCanGetFromA.length > 0)) {
      const sameCity = normalize(other.location) === normalize(userLocation) && !!userLocation;
      const sameProvince = sameCity || normalize(other.location || "").includes(normalize(userLocation || ""));
      const finalScore = calculateFinalScore({
        cardScore,
        reputation: other.rating || 0,
        sameProvince,
        sameCity,
      });

      matches.push({
        userId: other.id,
        userName: other.name,
        username: other.username,
        avatarUrl: other.avatar_url,
        location: other.location,
        rating: other.rating || 0,
        cardScore,
        finalScore,
        youCanGet: aCanGetFromB,
        theyCanGet: bCanGetFromA,
        matchedCount: matched,
      });
    }
  }

  return matches
    .sort((a, b) => b.finalScore - a.finalScore || b.matchedCount - a.matchedCount)
    .slice(0, maxResults);
}

function normalize(str) {
  return (str || "").toLowerCase().trim();
}
