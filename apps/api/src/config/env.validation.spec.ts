import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const validConfig = {
    DATABASE_URL: 'postgresql://auditor:auditor_dev_only@localhost:5432/uiux_auditor',
    JWT_SECRET: 'a-very-long-secure-and-random-jwt-secret-string-32-chars-min',
    JWT_EXPIRES_IN: '24h',
    BCRYPT_SALT_ROUNDS: '10',
    NODE_ENV: 'test',
    API_PORT: '4000',
    WEB_ORIGIN: 'http://localhost:3000',
  };

  it('accepts a valid environment configuration', () => {
    const validated = validateEnv(validConfig);
    expect(validated.DATABASE_URL).toBe(validConfig.DATABASE_URL);
    expect(validated.JWT_SECRET).toBe(validConfig.JWT_SECRET);
    expect(validated.JWT_EXPIRES_IN).toBe('24h');
    expect(validated.BCRYPT_SALT_ROUNDS).toBe(10);
    expect(validated.NODE_ENV).toBe('test');
    expect(validated.API_PORT).toBe(4000);
    expect(validated.WEB_ORIGIN).toBe('http://localhost:3000');
  });

  describe('DATABASE_URL validation', () => {
    it('rejects missing DATABASE_URL', () => {
      const config = { ...validConfig, DATABASE_URL: undefined };
      expect(() => validateEnv(config)).toThrow(
        /DATABASE_URL is required and cannot be empty/,
      );
    });

    it('rejects empty string DATABASE_URL', () => {
      const config = { ...validConfig, DATABASE_URL: '   ' };
      expect(() => validateEnv(config)).toThrow(
        /DATABASE_URL is required and cannot be empty/,
      );
    });

    it('rejects non-PostgreSQL protocol in DATABASE_URL', () => {
      const config = {
        ...validConfig,
        DATABASE_URL: 'mysql://user:pass@localhost:3306/db',
      };
      expect(() => validateEnv(config)).toThrow(
        /DATABASE_URL must be a valid PostgreSQL connection URL/,
      );
    });

    it('rejects malformed DATABASE_URL URI', () => {
      const config = { ...validConfig, DATABASE_URL: 'not-a-valid-uri' };
      expect(() => validateEnv(config)).toThrow(/DATABASE_URL must be a valid URI/);
    });
  });

  describe('JWT_SECRET validation', () => {
    it('rejects missing JWT_SECRET', () => {
      const config = { ...validConfig, JWT_SECRET: undefined };
      expect(() => validateEnv(config)).toThrow(
        /JWT_SECRET is required and cannot be blank/,
      );
    });

    it('rejects blank/whitespace JWT_SECRET', () => {
      const config = { ...validConfig, JWT_SECRET: '    ' };
      expect(() => validateEnv(config)).toThrow(
        /JWT_SECRET is required and cannot be blank/,
      );
    });

    it('rejects JWT_SECRET shorter than 32 characters', () => {
      const config = { ...validConfig, JWT_SECRET: 'too-short-secret' };
      expect(() => validateEnv(config)).toThrow(
        /JWT_SECRET must be at least 32 characters long/,
      );
    });

    it('rejects the known example placeholder JWT_SECRET', () => {
      const config = {
        ...validConfig,
        JWT_SECRET: 'replace-with-a-long-random-secret-before-authentication',
      };
      expect(() => validateEnv(config)).toThrow(
        /JWT_SECRET cannot use an insecure default or the example placeholder/,
      );
    });

    it('rejects known insecure defaults like "secret" or "changeme"', () => {
      const config = { ...validConfig, JWT_SECRET: 'secret' };
      expect(() => validateEnv(config)).toThrow(
        /JWT_SECRET must be at least 32 characters long/,
      );
    });

    it('never includes secret values or database credentials in validation error messages', () => {
      const sensitiveSecret = 'replace-with-a-long-random-secret-before-authentication';
      const sensitiveDb = 'postgresql://sensitive_user:sensitive_password@db.internal:5432/secret_db';
      const config = {
        DATABASE_URL: 'http://not-postgres.com',
        JWT_SECRET: sensitiveSecret,
      };

      try {
        validateEnv(config);
        fail('Expected validateEnv to throw');
      } catch (err: unknown) {
        const message = (err as Error).message;
        expect(message).not.toContain(sensitiveSecret);
        expect(message).not.toContain(sensitiveDb);
        expect(message).not.toContain('sensitive_password');
      }
    });
  });

  describe('JWT_EXPIRES_IN validation', () => {
    it('defaults to 24h when omitted', () => {
      const { JWT_EXPIRES_IN: _, ...config } = validConfig;
      const validated = validateEnv(config);
      expect(validated.JWT_EXPIRES_IN).toBe('24h');
    });

    it('accepts valid duration strings (15m, 1h, 7d)', () => {
      expect(validateEnv({ ...validConfig, JWT_EXPIRES_IN: '15m' }).JWT_EXPIRES_IN).toBe('15m');
      expect(validateEnv({ ...validConfig, JWT_EXPIRES_IN: '1h' }).JWT_EXPIRES_IN).toBe('1h');
      expect(validateEnv({ ...validConfig, JWT_EXPIRES_IN: '7d' }).JWT_EXPIRES_IN).toBe('7d');
    });

    it('rejects invalid or unbounded duration strings', () => {
      expect(() => validateEnv({ ...validConfig, JWT_EXPIRES_IN: 'never' })).toThrow(
        /JWT_EXPIRES_IN must be a valid duration/,
      );
      expect(() => validateEnv({ ...validConfig, JWT_EXPIRES_IN: '30d' })).toThrow(
        /JWT_EXPIRES_IN duration must be between 60s and 7d/,
      );
      expect(() => validateEnv({ ...validConfig, JWT_EXPIRES_IN: '10s' })).toThrow(
        /JWT_EXPIRES_IN duration must be between 60s and 7d/,
      );
    });
  });

  describe('BCRYPT_SALT_ROUNDS validation', () => {
    it('defaults to 10 when omitted', () => {
      const { BCRYPT_SALT_ROUNDS: _, ...config } = validConfig;
      const validated = validateEnv(config);
      expect(validated.BCRYPT_SALT_ROUNDS).toBe(10);
    });

    it('accepts valid salt rounds between 10 and 14', () => {
      expect(validateEnv({ ...validConfig, BCRYPT_SALT_ROUNDS: '12' }).BCRYPT_SALT_ROUNDS).toBe(12);
    });

    it('rejects salt rounds less than 10 or greater than 14', () => {
      expect(() => validateEnv({ ...validConfig, BCRYPT_SALT_ROUNDS: '8' })).toThrow(
        /BCRYPT_SALT_ROUNDS must be an integer between 10 and 14/,
      );
      expect(() => validateEnv({ ...validConfig, BCRYPT_SALT_ROUNDS: '16' })).toThrow(
        /BCRYPT_SALT_ROUNDS must be an integer between 10 and 14/,
      );
    });
  });

  describe('NODE_ENV & API_PORT validation', () => {
    it('defaults NODE_ENV to development when omitted', () => {
      const { NODE_ENV: _, ...config } = validConfig;
      const validated = validateEnv(config);
      expect(validated.NODE_ENV).toBe('development');
    });

    it('rejects invalid NODE_ENV', () => {
      const config = { ...validConfig, NODE_ENV: 'staging' };
      expect(() => validateEnv(config)).toThrow(
        /NODE_ENV must be one of 'development', 'test', or 'production'/,
      );
    });

    it('defaults API_PORT to 4000 when omitted', () => {
      const { API_PORT: _, ...config } = validConfig;
      const validated = validateEnv(config);
      expect(validated.API_PORT).toBe(4000);
    });

    it('rejects non-numeric API_PORT', () => {
      const config = { ...validConfig, API_PORT: 'invalid-port' };
      expect(() => validateEnv(config)).toThrow(
        /API_PORT must be an integer between 1 and 65535/,
      );
    });

    it('rejects out-of-range API_PORT', () => {
      const config = { ...validConfig, API_PORT: '70000' };
      expect(() => validateEnv(config)).toThrow(
        /API_PORT must be an integer between 1 and 65535/,
      );
    });
  });
});
