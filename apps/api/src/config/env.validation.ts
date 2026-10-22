export interface EnvConfig {
  DATABASE_URL: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  BCRYPT_SALT_ROUNDS: number;
  NODE_ENV: 'development' | 'test' | 'production';
  API_PORT: number;
  WEB_ORIGIN: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_PASSWORD?: string;
  REDIS_TLS?: boolean;
}

const KNOWN_INSECURE_PLACEHOLDERS = new Set([
  'replace-with-a-long-random-secret-before-authentication',
  'secret',
  'changeme',
  'jwt_secret',
  'your-jwt-secret-here',
  'supersecret',
]);

const DURATION_REGEX = /^(\d+)([smhd])$/;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const errors: string[] = [];

  // 1. DATABASE_URL
  const rawDbUrl = config.DATABASE_URL;
  let databaseUrl = '';
  if (typeof rawDbUrl !== 'string' || rawDbUrl.trim() === '') {
    errors.push('DATABASE_URL is required and cannot be empty.');
  } else {
    databaseUrl = rawDbUrl.trim();
    try {
      const parsed = new URL(databaseUrl);
      if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
        errors.push(
          'DATABASE_URL must be a valid PostgreSQL connection URL starting with postgresql:// or postgres://.',
        );
      }
    } catch {
      errors.push('DATABASE_URL must be a valid URI.');
    }
  }

  // 2. JWT_SECRET
  const rawJwtSecret = config.JWT_SECRET;
  let jwtSecret = '';
  if (typeof rawJwtSecret !== 'string' || rawJwtSecret.trim() === '') {
    errors.push('JWT_SECRET is required and cannot be blank.');
  } else {
    jwtSecret = rawJwtSecret.trim();
    if (jwtSecret.length < 32) {
      errors.push('JWT_SECRET must be at least 32 characters long.');
    }
    if (KNOWN_INSECURE_PLACEHOLDERS.has(jwtSecret.toLowerCase())) {
      errors.push(
        'JWT_SECRET cannot use an insecure default or the example placeholder.',
      );
    }
  }

  // 3. JWT_EXPIRES_IN
  const rawJwtExpiresIn = config.JWT_EXPIRES_IN;
  let jwtExpiresIn = '24h';
  if (rawJwtExpiresIn !== undefined && rawJwtExpiresIn !== null && rawJwtExpiresIn !== '') {
    const trimmed = String(rawJwtExpiresIn).trim();
    const match = DURATION_REGEX.exec(trimmed);
    if (match) {
      const amount = Number(match[1]);
      const unit = match[2];
      let seconds = 0;
      if (unit === 's') seconds = amount;
      else if (unit === 'm') seconds = amount * 60;
      else if (unit === 'h') seconds = amount * 3600;
      else if (unit === 'd') seconds = amount * 86400;

      if (seconds < 60 || seconds > 604800) {
        errors.push('JWT_EXPIRES_IN duration must be between 60s and 7d.');
      } else {
        jwtExpiresIn = trimmed;
      }
    } else {
      const asNumber = Number(trimmed);
      if (Number.isInteger(asNumber) && asNumber >= 60 && asNumber <= 604800) {
        jwtExpiresIn = `${asNumber}s`;
      } else {
        errors.push(
          "JWT_EXPIRES_IN must be a valid duration string (e.g., '15m', '1h', '24h', '7d') between 60s and 7d.",
        );
      }
    }
  }

  // 4. BCRYPT_SALT_ROUNDS
  const rawSaltRounds = config.BCRYPT_SALT_ROUNDS;
  let bcryptSaltRounds = 10;
  if (rawSaltRounds !== undefined && rawSaltRounds !== null && rawSaltRounds !== '') {
    const parsedRounds = Number(rawSaltRounds);
    if (Number.isInteger(parsedRounds) && parsedRounds >= 10 && parsedRounds <= 14) {
      bcryptSaltRounds = parsedRounds;
    } else {
      errors.push('BCRYPT_SALT_ROUNDS must be an integer between 10 and 14.');
    }
  }

  // 5. NODE_ENV
  const rawNodeEnv = config.NODE_ENV;
  let nodeEnv: 'development' | 'test' | 'production' = 'development';
  if (rawNodeEnv !== undefined && rawNodeEnv !== null && rawNodeEnv !== '') {
    const trimmed = String(rawNodeEnv).trim();
    if (['development', 'test', 'production'].includes(trimmed)) {
      nodeEnv = trimmed as 'development' | 'test' | 'production';
    } else {
      errors.push(
        "NODE_ENV must be one of 'development', 'test', or 'production'.",
      );
    }
  }

  // 6. API_PORT
  const rawPort = config.API_PORT;
  let apiPort = 4000;
  if (rawPort !== undefined && rawPort !== null && rawPort !== '') {
    const parsedPort = Number(rawPort);
    if (Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535) {
      apiPort = parsedPort;
    } else {
      errors.push('API_PORT must be an integer between 1 and 65535.');
    }
  }

  // 7. WEB_ORIGIN
  const rawOrigin = config.WEB_ORIGIN;
  let webOrigin = 'http://localhost:3000';
  if (typeof rawOrigin === 'string' && rawOrigin.trim() !== '') {
    webOrigin = rawOrigin.trim();
  }

  // 8. REDIS_HOST
  const rawRedisHost = config.REDIS_HOST;
  let redisHost = 'localhost';
  if (rawRedisHost !== undefined && rawRedisHost !== null && rawRedisHost !== '') {
    const trimmed = String(rawRedisHost).trim();
    if (trimmed.length > 0) {
      redisHost = trimmed;
    }
  }

  // 9. REDIS_PORT
  const rawRedisPort = config.REDIS_PORT;
  let redisPort = 6379;
  if (rawRedisPort !== undefined && rawRedisPort !== null && rawRedisPort !== '') {
    const parsedRedisPort = Number(rawRedisPort);
    if (Number.isInteger(parsedRedisPort) && parsedRedisPort >= 1 && parsedRedisPort <= 65535) {
      redisPort = parsedRedisPort;
    } else {
      errors.push('REDIS_PORT must be an integer between 1 and 65535.');
    }
  }

  // 10. REDIS_PASSWORD
  const rawRedisPassword = config.REDIS_PASSWORD;
  let redisPassword: string | undefined = undefined;
  if (rawRedisPassword !== undefined && rawRedisPassword !== null && rawRedisPassword !== '') {
    const trimmed = String(rawRedisPassword).trim();
    if (trimmed.length > 0) {
      redisPassword = trimmed;
    }
  }

  // 11. REDIS_TLS
  const rawRedisTls = config.REDIS_TLS;
  let redisTls = false;
  if (rawRedisTls !== undefined && rawRedisTls !== null && rawRedisTls !== '') {
    const stringVal = String(rawRedisTls).trim().toLowerCase();
    if (stringVal === 'true' || stringVal === '1') {
      redisTls = true;
    } else if (stringVal === 'false' || stringVal === '0') {
      redisTls = false;
    } else {
      errors.push("REDIS_TLS must be a boolean ('true' or 'false').");
    }
  }

  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n  - ${errors.join('\n  - ')}`);
  }

  return {
    DATABASE_URL: databaseUrl,
    JWT_SECRET: jwtSecret,
    JWT_EXPIRES_IN: jwtExpiresIn,
    BCRYPT_SALT_ROUNDS: bcryptSaltRounds,
    NODE_ENV: nodeEnv,
    API_PORT: apiPort,
    WEB_ORIGIN: webOrigin,
    REDIS_HOST: redisHost,
    REDIS_PORT: redisPort,
    REDIS_PASSWORD: redisPassword,
    REDIS_TLS: redisTls,
  };
}
