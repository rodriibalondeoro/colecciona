/**
 * Trade Matching Algorithm
 * Finds compatible traders by comparing what each user has vs what they want.
 * Uses composite key (card_name + card_number + set_name) for accurate matching.
 * Includes quantity-awareness, reputation, and proximity scoring.
 */

/**
 * Generate a unique card key from card properties.
 * Two cards match only if name, number, and set are identical.
 */
function cardKey(item) {
  return normalize(`${item.card_name || ""}|${item.card_number || ""}|${item.set_name || ""}`);
}

/**
 * Calculate compatibility score between two users.
 * Uses composite card keys for accurate matching.
 * @param {Object} userA - { wants: [...cardKeys], offers: [...{key, quantity}] }
 * @param {Object} userB - { wants: [...cardKeys], offers: [...{key, quantity}] }
 * @returns {Object} { cardScore, aCanGetFromB, bCanGetFromA, matchedQuantity }
 */
export function calculateCompatibility(userA, userB) {
  // Build offer maps: cardKey -> available quantity
  const aOfferMap = new Map();
  for (const item of (userA.offers || [])) {
    const key = typeof item === "string" ? item : item.key;
    const qty = typeof item === "string" ? 1 : (item.quantity || 1);
    aOfferMap.set(key, (aOfferMap.get(key) || 0) + qty);
  }

  const bOfferMap = new Map();
  for (const item of (userB.offers || [])) {
    const key = typeof item === "string" ? item : item.key;
    const qty = typeof item === "string" ? 1 : (item.quantity || 1);
    bOfferMap.set(key, (bOfferMap.get(key) || 0) + qty);
  }

  const aWants = new Set((userA.wants || []).map(w => typeof w === "string" ? w : w.key));
  const bWants = new Set((userB.wants || []).map(w => typeof w === "string" ? w : w.key));

  // What A can get from B (A wants, B offers)
  const aCanGetFromB = [];
  let aMatchQty = 0;
  for (const want of aWants) {
    const available = bOfferMap.get(want) || 0;
    if (available > 0) {
      aCanGetFromB.push({ key: want, available });
      aMatchQty += available;
    }
  }

  // What B can get from A (B wants, A offers)
  const bCanGetFromA = [];
  let bMatchQty = 0;
  for (const want of bWants) {
    const available = aOfferMap.get(want) || 0;
    if (available > 0) {
      bCanGetFromA.push({ key: want, available });
      bMatchQty += available;
    }
  }

  const totalWants = aWants.size + bWants.size || 1;
  const matchedCards = aCanGetFromB.length + bCanGetFromA.length;

  // Card score: percentage of wants that can be fulfilled
  const cardScore = Math.round((matchedCards / totalWants) * 100);

  return {
    cardScore: Math.min(cardScore, 100),
    aCanGetFromB,
    bCanGetFromA,
    matchedCards,
    matchedQuantity: aMatchQty + bMatchQty,
    totalWants,
  };
}

/**
 * Calculate final score combining card compatibility, reputation, and distance.
 * Weights: 80% cards, 10% reputation, 10% proximity.
 */
export function calculateFinalScore({ cardScore, reputation = 0, sameProvince = false, sameCity = false }) {
  const repBonus = Math.min((reputation / 5) * 10, 10);
  const distBonus = sameCity ? 10 : sameProvince ? 5 : 0;
  const finalScore = Math.round(cardScore * 0.8 + repBonus + distBonus);
  return Math.min(finalScore, 100);
}

/**
 * Find top matches for a user from a pool of other users.
 * Only includes matches where BOTH parties get something (bidirectional).
 * @param {Object} targetUser - { id, wants: [...cardKeys], offers: [...{key, quantity}] }
 * @param {Array} otherUsers - [{ id, wants, offers, rating, location }]
 * @param {Object} options - { minScore: 10, maxResults: 20, userLocation: "Madrid" }
 * @returns {Array} sorted matches with compatibility data
 */
export function findMatches(targetUser, otherUsers, options = {}) {
  const { minScore = 10, maxResults = 20, userLocation = "" } = options;
  const matches = [];

  for (const other of otherUsers) {
    if (other.id === targetUser.id) continue;

    const { cardScore, aCanGetFromB, bCanGetFromA, matchedCards, matchedQuantity } =
      calculateCompatibility(targetUser, other);

    // Require BIDIRECTIONAL match: both parties must get something
    if (cardScore >= minScore && aCanGetFromB.length > 0 && bCanGetFromA.length > 0) {
      const userLoc = normalize(userLocation);
      const otherLoc = normalize(other.location || "");
      const sameCity = otherLoc === userLoc && !!userLoc;
      // Province: exact match or contained (e.g., "Madrid" in "Madrid, España")
      const sameProvince = sameCity || (otherLoc.includes(userLoc) || userLoc.includes(otherLoc));

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
        avatarUrl: other.avatar,
        location: other.location,
        rating: other.rating || 0,
        cardScore,
        finalScore,
        youCanGet: aCanGetFromB,
        theyCanGet: bCanGetFromA,
        matchedCards,
        matchedQuantity,
      });
    }
  }

  return matches
    .sort((a, b) => b.finalScore - a.finalScore || b.matchedCards - a.matchedCards)
    .slice(0, maxResults);
}

function normalize(str) {
  return (str || "").toLowerCase().trim();
}

/**
 * Build a card key from a collection item (for use in API routes).
 */
export function itemToKey(item) {
  return cardKey(item);
}
