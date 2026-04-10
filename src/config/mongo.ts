import mongoose from "mongoose";
import { env } from "./env";

// Connection pool + timeout defaults. Previously we passed only dbName and
// inherited Mongoose's defaults, which leaves the pool small and the
// server-selection timeout long enough to mask a dead cluster from the
// Discord command handlers. These values are tuned for a single PM2
// instance running ~dozens of concurrent slash commands + autocomplete
// events; raise maxPoolSize if the workload grows. See issue #14.
const MONGO_CONNECT_OPTIONS: mongoose.ConnectOptions = {
  dbName: env.MONGODB_DB_NAME,
  maxPoolSize: 25,
  minPoolSize: 5,
  // Fail fast when the cluster is unreachable — default is 30s which
  // silently blocks every command behind a cold connection.
  serverSelectionTimeoutMS: 5_000,
  // Cap idle socket lifetime so a long-running process doesn't accumulate
  // half-open TCP connections behind NAT / load balancers.
  socketTimeoutMS: 45_000,
};

export async function connectMongo() {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(env.MONGODB_URI, MONGO_CONNECT_OPTIONS);
}
