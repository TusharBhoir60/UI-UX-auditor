import {
  IsNotEmpty,
  IsString,
  MaxLength,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Custom validator constraint ensuring input is a syntactically valid absolute HTTP or HTTPS URL.
 *
 * Requirements:
 * - Must be an absolute URL with 'http:' or 'https:' scheme.
 * - Rejects unsupported schemes (e.g., javascript:, file:, data:, ftp:, ws:).
 * - Rejects malformed URL strings, empty strings, and whitespace.
 * - Does not perform network calls, DNS lookups, or URL fetching (syntactic check only).
 *
 * Policy Decision on URL Normalization & Storage:
 * - Whitespace is rejected rather than silently stripped to ensure deterministic client intent.
 * - The validated URL is preserved intact without modifying path casing, query parameters, or fragments,
 *   as path components in HTTP/HTTPS URLs are case-sensitive.
 *
 * Policy Decision on Embedded Credentials:
 * - Authoritative documents (docs/API_SPEC.md, docs/SECURITY.md) do not specify rejecting syntactically
 *   valid URLs containing userinfo (e.g., http://user:pass@example.com).
 * - Standard WHATWG URL parsing treats these as valid absolute URLs. Full credential stripping or
 *   disallowance is reserved for capture-stage network policy enforcement.
 */
@ValidatorConstraint({ name: 'isValidHttpUrl', async: false })
export class IsValidHttpUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, _args: ValidationArguments): boolean {
    if (typeof value !== 'string') {
      return false;
    }

    // Reject URLs with whitespace, tabs, newlines, or carriage returns
    if (/[\s\r\n\t]/.test(value)) {
      return false;
    }

    if (value.length === 0 || value.length > 2048) {
      return false;
    }

    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }
      if (!parsed.hostname || parsed.hostname.length === 0) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'url must be a valid absolute http or https URL';
  }
}

export function IsValidHttpUrl(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidHttpUrlConstraint,
    });
  };
}

export class CreateAuditDto {
  @IsString({ message: 'url must be a string' })
  @IsNotEmpty({ message: 'url should not be empty' })
  @MaxLength(2048, { message: 'url must not exceed 2048 characters' })
  @IsValidHttpUrl()
  url!: string;
}
