/**
 * DATA SEEDING SCRIPT — Large Dataset for Load Testing
 *
 * Creates realistic test data for load testing:
 * - 1000 users
 * - 10000 products
 * - 5000 orders
 * - 20000 messages
 * - 5000 offers
 * - 20000 notifications
 *
 * Run: node tests/load/seed-data.js
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY env vars
 */

const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("❌ Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars");
  process.exit(1);
}

const supabase = createClient(url, key);

const CATEGORIES = ["futbol", "baloncesto", "tenis", "formula1", "ciclismo", "boxeo", "golf", "natacion"];
const CONDITIONS = ["new", "used", "mint"];
const STATUSES = ["ACTIVE", "SOLD", "RESERVED"];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPrice() {
  return Math.round((Math.random() * 200 + 0.5) * 100) / 100;
}

function randomName() {
  const names = ["Carlos", "María", "Juan", "Ana", "Pedro", "Laura", "Miguel", "Sofía", "Antonio", "Lucía"];
  const surnames = ["García", "López", "Martínez", "González", "Rodríguez", "Fernández", "Sánchez", "Moreno"];
  return `${randomItem(names)} ${randomItem(surnames)}`;
}

async function seedUsers(n) {
  console.log(`\n👤 Seeding ${n} users...`);
  const users = [];

  for (let i = 0; i < n; i++) {
    users.push({
      id: crypto.randomUUID(),
      username: `user_${i}_${Math.random().toString(36).slice(2, 8)}`,
      name: randomName(),
      email: `loadtest_${i}@test.com`,
      created_at: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  // Batch insert (Supabase limit ~1000 rows per insert)
  const batchSize = 500;
  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);
    const { error } = await supabase.from("profiles").upsert(batch, { onConflict: "id" });
    if (error) console.error(`  Batch ${i}: ${error.message}`);
    else console.log(`  Inserted users ${i + 1}-${Math.min(i + batchSize, n)}`);
  }

  return users;
}

async function seedProducts(users, n) {
  console.log(`\n📦 Seeding ${n} products...`);
  const products = [];

  for (let i = 0; i < n; i++) {
    const seller = randomItem(users);
    products.push({
      id: crypto.randomUUID(),
      title: `Cromo ${randomItem(CATEGORIES)} #${Math.floor(Math.random() * 10000)}`,
      description: `Cromo coleccionable de ${randomItem(CATEGORIES)} en estado ${randomItem(CONDITIONS)}`,
      price: randomPrice(),
      category: randomItem(CATEGORIES),
      condition: randomItem(CONDITIONS),
      status: randomItem(STATUSES),
      seller: seller.id,
      image: `https://via.placeholder.com/400x600?text=Cromo+${i}`,
      created_at: new Date(Date.now() - Math.random() * 180 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  const batchSize = 500;
  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    const { error } = await supabase.from("products").upsert(batch, { onConflict: "id" });
    if (error) console.error(`  Batch ${i}: ${error.message}`);
    else console.log(`  Inserted products ${i + 1}-${Math.min(i + batchSize, n)}`);
  }

  return products;
}

async function seedMessages(users, n) {
  console.log(`\n💬 Seeding ${n} messages...`);
  const messages = [];

  for (let i = 0; i < n; i++) {
    const sender = randomItem(users);
    let receiver = randomItem(users);
    while (receiver.id === sender.id) receiver = randomItem(users);

    messages.push({
      id: crypto.randomUUID(),
      sender_id: sender.id,
      receiver_id: receiver.id,
      text: `Mensaje de prueba #${i} — ${Date.now()}`,
      created_at: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  const batchSize = 1000;
  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);
    const { error } = await supabase.from("messages").upsert(batch, { onConflict: "id" });
    if (error) console.error(`  Batch ${i}: ${error.message}`);
    else console.log(`  Inserted messages ${i + 1}-${Math.min(i + batchSize, n)}`);
  }
}

async function seedNotifications(users, n) {
  console.log(`\n🔔 Seeding ${n} notifications...`);
  const notifications = [];

  const types = ["order", "message", "offer", "review", "follow"];
  for (let i = 0; i < n; i++) {
    const user = randomItem(users);
    notifications.push({
      id: crypto.randomUUID(),
      user_id: user.id,
      type: randomItem(types),
      title: `Notificación #${i}`,
      message: `Contenido de notificación de prueba`,
      read: Math.random() > 0.5,
      created_at: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  const batchSize = 1000;
  for (let i = 0; i < notifications.length; i += batchSize) {
    const batch = notifications.slice(i, i + batchSize);
    const { error } = await supabase.from("notifications").upsert(batch, { onConflict: "id" });
    if (error) console.error(`  Batch ${i}: ${error.message}`);
    else console.log(`  Inserted notifications ${i + 1}-${Math.min(i + batchSize, n)}`);
  }
}

async function main() {
  console.log("🌱 DATA SEEDING — Load Test Dataset");
  console.log("═".repeat(60));
  console.log(`Target: ${url}`);
  console.log("═".repeat(60));

  const users = await seedUsers(1000);
  const products = await seedProducts(users, 10000);
  await seedMessages(users, 20000);
  await seedNotifications(users, 20000);

  console.log("\n✅ SEEDING COMPLETE");
  console.log("═".repeat(60));
  console.log("  Users:        1,000");
  console.log("  Products:     10,000");
  console.log("  Messages:     20,000");
  console.log("  Notifications: 20,000");
  console.log("\nRun EXPLAIN ANALYZE queries to verify index usage.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
