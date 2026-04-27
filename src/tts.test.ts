import { describe, it, expect } from 'vitest';

import { prepareForSpeech } from './tts.js';

describe('prepareForSpeech', () => {
  describe('currency', () => {
    it('spells out rand with cents', () => {
      expect(prepareForSpeech('R25.82')).toBe('25 rand and 82 cents');
    });

    it('spells out rand without cents', () => {
      expect(prepareForSpeech('R25')).toBe('25 rand');
    });

    it('handles thousands separators', () => {
      expect(prepareForSpeech('R1,234.56')).toBe('1234 rand and 56 cents');
    });

    it('handles space between symbol and amount', () => {
      expect(prepareForSpeech('R 100')).toBe('100 rand');
    });

    it('handles half-decimal values', () => {
      expect(prepareForSpeech('R25.5')).toBe('25 rand and 50 cents');
    });

    it('drops zero cents', () => {
      expect(prepareForSpeech('R25.00')).toBe('25 rand');
    });

    it('handles USD', () => {
      expect(prepareForSpeech('$100.50')).toBe('100 dollars and 50 cents');
    });

    it('handles GBP', () => {
      expect(prepareForSpeech('£50.25')).toBe('50 pounds and 25 pence');
    });

    it('handles EUR', () => {
      expect(prepareForSpeech('€75')).toBe('75 euros');
    });

    it('handles ZAR code', () => {
      expect(prepareForSpeech('ZAR 500')).toBe('500 rand');
    });

    it('handles currency in a sentence', () => {
      expect(prepareForSpeech('The price is R25.82 today')).toBe(
        'The price is 25 rand and 82 cents today',
      );
    });
  });

  describe('URLs', () => {
    it('replaces bare https URL with "link"', () => {
      expect(prepareForSpeech('Visit https://example.com/path')).toBe(
        'Visit link',
      );
    });

    it('replaces bare http URL with "link"', () => {
      expect(prepareForSpeech('See http://foo.bar/page')).toBe('See link');
    });

    it('replaces www URL with "link"', () => {
      expect(prepareForSpeech('Check www.example.com')).toBe('Check link');
    });

    it('keeps markdown link text and drops the URL', () => {
      expect(
        prepareForSpeech('See the [documentation](https://example.com/docs)'),
      ).toBe('See the documentation');
    });
  });

  describe('emails', () => {
    it('replaces email with "email address"', () => {
      expect(prepareForSpeech('Contact colman@iosiro.com today')).toBe(
        'Contact email address today',
      );
    });
  });

  describe('markdown', () => {
    it('strips bold', () => {
      expect(prepareForSpeech('This is **important**')).toBe(
        'This is important',
      );
    });

    it('strips italic', () => {
      expect(prepareForSpeech('This is *emphasized*')).toBe(
        'This is emphasized',
      );
    });

    it('strips headers', () => {
      expect(prepareForSpeech('# Title\nContent')).toBe('Title Content');
    });

    it('strips bullet markers', () => {
      expect(prepareForSpeech('- item one\n- item two')).toBe(
        'item one item two',
      );
    });

    it('keeps inline code content', () => {
      expect(prepareForSpeech('Run `npm install` now')).toBe(
        'Run npm install now',
      );
    });

    it('replaces code blocks with placeholder', () => {
      expect(
        prepareForSpeech('Here is some code:\n```\nconsole.log("hi");\n```\nDone'),
      ).toBe('Here is some code: code omitted Done');
    });
  });

  describe('abbreviations', () => {
    it('expands e.g.', () => {
      expect(prepareForSpeech('Fruit, e.g. apples')).toBe(
        'Fruit, for example, apples',
      );
    });

    it('expands i.e.', () => {
      expect(prepareForSpeech('The CEO, i.e. the boss')).toBe(
        'The CEO, that is, the boss',
      );
    });

    it('expands etc.', () => {
      expect(prepareForSpeech('Apples, oranges, etc.')).toBe(
        'Apples, oranges, and so on',
      );
    });

    it('expands vs', () => {
      expect(prepareForSpeech('Cats vs dogs')).toBe('Cats versus dogs');
    });
  });

  describe('file paths', () => {
    it('replaces absolute paths with "file path"', () => {
      expect(prepareForSpeech('Edit /home/user/config.json now')).toBe(
        'Edit file path now',
      );
    });
  });

  describe('whitespace', () => {
    it('collapses paragraph breaks to sentence pauses', () => {
      expect(prepareForSpeech('First para.\n\nSecond para.')).toBe(
        'First para. Second para.',
      );
    });

    it('collapses multiple spaces', () => {
      expect(prepareForSpeech('too   many    spaces')).toBe(
        'too many spaces',
      );
    });
  });

  describe('combined', () => {
    it('handles a realistic response', () => {
      const input =
        '**Update**: You have R25.82 left.\n\nSee https://bank.co.za/balance for details.';
      expect(prepareForSpeech(input)).toBe(
        'Update: You have 25 rand and 82 cents left. See link for details.',
      );
    });
  });
});
