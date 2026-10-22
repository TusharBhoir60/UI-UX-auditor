import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateAuditDto } from './create-audit.dto';

describe('CreateAuditDto Validation with ValidationPipe', () => {
  let pipe: ValidationPipe;

  beforeEach(() => {
    pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
  });

  describe('Valid URL cases', () => {
    it('passes validation with a standard https URL', async () => {
      const input = { url: 'https://example.com' };
      const result = await pipe.transform(input, {
        type: 'body',
        metatype: CreateAuditDto,
      });

      expect(result).toBeInstanceOf(CreateAuditDto);
      expect(result.url).toBe('https://example.com');
    });

    it('passes validation with standard http URL and port', async () => {
      const input = { url: 'http://localhost:3000' };
      const result = await pipe.transform(input, {
        type: 'body',
        metatype: CreateAuditDto,
      });

      expect(result).toBeInstanceOf(CreateAuditDto);
      expect(result.url).toBe('http://localhost:3000');
    });

    it('passes validation with IP address, path, query parameters, and fragment', async () => {
      const input = {
        url: 'http://127.0.0.1:8080/dashboard/audit?sort=desc&filter=critical#summary',
      };
      const result = await pipe.transform(input, {
        type: 'body',
        metatype: CreateAuditDto,
      });

      expect(result).toBeInstanceOf(CreateAuditDto);
      expect(result.url).toBe(input.url);
    });

    it('passes validation with deep path and mixed-case query/path', async () => {
      const input = {
        url: 'https://sub.domain.co.uk/Api/V1/Resources?CaseSensitiveParam=Value123',
      };
      const result = await pipe.transform(input, {
        type: 'body',
        metatype: CreateAuditDto,
      });

      expect(result).toBeInstanceOf(CreateAuditDto);
      expect(result.url).toBe(input.url);
    });

    it('passes validation when URL length is exactly 2048 characters', async () => {
      const base = 'https://example.com/search?q=';
      const paddingLength = 2048 - base.length;
      const longUrl = base + 'a'.repeat(paddingLength);
      expect(longUrl.length).toBe(2048);

      const result = await pipe.transform(
        { url: longUrl },
        { type: 'body', metatype: CreateAuditDto },
      );

      expect(result).toBeInstanceOf(CreateAuditDto);
      expect(result.url.length).toBe(2048);
    });

    /**
     * Policy Decision on URL credentials:
     * Authoritative documents (docs/API_SPEC.md, docs/SECURITY.md) do not specify rejecting
     * URLs containing user credentials at the submission boundary.
     * Per WHATWG URL standards, syntactically valid HTTP/HTTPS URLs with userinfo
     * (e.g., http://user:pass@example.com) are parsed as valid absolute URLs.
     * We allow syntactically valid URLs without inventing non-specified rejection rules.
     */
    it('accepts syntactically valid URLs containing credentials (policy decision flagged)', async () => {
      const input = { url: 'http://user:password@example.com/protected' };
      const result = await pipe.transform(input, {
        type: 'body',
        metatype: CreateAuditDto,
      });

      expect(result).toBeInstanceOf(CreateAuditDto);
      expect(result.url).toBe('http://user:password@example.com/protected');
    });
  });

  describe('Invalid URL cases', () => {
    it('rejects missing url field', async () => {
      const input = {};
      await expect(
        pipe.transform(input, { type: 'body', metatype: CreateAuditDto }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects empty string url', async () => {
      const input = { url: '' };
      await expect(
        pipe.transform(input, { type: 'body', metatype: CreateAuditDto }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects whitespace-only url', async () => {
      const input = { url: '   ' };
      await expect(
        pipe.transform(input, { type: 'body', metatype: CreateAuditDto }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects non-string url', async () => {
      const input = { url: 12345 };
      await expect(
        pipe.transform(input, { type: 'body', metatype: CreateAuditDto }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects url with leading or trailing whitespace', async () => {
      await expect(
        pipe.transform(
          { url: ' https://example.com' },
          { type: 'body', metatype: CreateAuditDto },
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        pipe.transform(
          { url: 'https://example.com ' },
          { type: 'body', metatype: CreateAuditDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects url with internal whitespace or newline', async () => {
      await expect(
        pipe.transform(
          { url: 'https://example.com/page with spaces' },
          { type: 'body', metatype: CreateAuditDto },
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        pipe.transform(
          { url: 'https://example.com/page\n' },
          { type: 'body', metatype: CreateAuditDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects completely malformed url strings', async () => {
      const malformedUrls = [
        'not-a-url',
        'http://',
        'https://',
        '//example.com',
        '/relative/path',
        'example.com',
      ];

      for (const url of malformedUrls) {
        await expect(
          pipe.transform({ url }, { type: 'body', metatype: CreateAuditDto }),
        ).rejects.toThrow(BadRequestException);
      }
    });

    it('rejects unsupported schemes (javascript, file, data, ftp, mailto, ws)', async () => {
      const unsupported = [
        'javascript:alert(1)',
        'file:///etc/passwd',
        'data:text/html,<h1>Hello</h1>',
        'ftp://ftp.example.com/file.txt',
        'mailto:support@example.com',
        'ws://localhost:4000/socket',
      ];

      for (const url of unsupported) {
        await expect(
          pipe.transform({ url }, { type: 'body', metatype: CreateAuditDto }),
        ).rejects.toThrow(BadRequestException);
      }
    });

    it('rejects URL exceeding 2048 characters', async () => {
      const base = 'https://example.com/search?q=';
      const overLongUrl = base + 'a'.repeat(2049 - base.length);
      expect(overLongUrl.length).toBe(2049);

      await expect(
        pipe.transform(
          { url: overLongUrl },
          { type: 'body', metatype: CreateAuditDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects unrecognized extra fields such as userId or status', async () => {
      const input = {
        url: 'https://example.com',
        userId: '11111111-2222-3333-4444-555555555555',
        status: 'complete',
      };

      await expect(
        pipe.transform(input, { type: 'body', metatype: CreateAuditDto }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
