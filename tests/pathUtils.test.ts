import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  getParentPath,
  joinPath,
  getBaseName,
  isRootPath
} from '../src/utils/pathUtils';

describe('pathUtils · cross-platform paths', () => {
  describe('normalizePath', () => {
    it('normalizes backslashes to slashes', () => {
      expect(normalizePath('C:\\Users\\test\\docs')).toBe('C:/Users/test/docs');
      expect(normalizePath('C:\\')).toBe('C:/');
      expect(normalizePath('C:')).toBe('C:/');
    });

    it('normalizes POSIX paths and cleans trailing slashes', () => {
      expect(normalizePath('/etc/nginx/')).toBe('/etc/nginx');
      expect(normalizePath('/etc/nginx/conf.d')).toBe('/etc/nginx/conf.d');
      expect(normalizePath('/')).toBe('/');
      expect(normalizePath('')).toBe('/');
    });
  });

  describe('isRootPath', () => {
    it('identifies roots correctly', () => {
      expect(isRootPath('/')).toBe(true);
      expect(isRootPath('C:/')).toBe(true);
      expect(isRootPath('C:\\')).toBe(true);
      expect(isRootPath('d:/')).toBe(true);
      expect(isRootPath('/etc')).toBe(false);
      expect(isRootPath('C:/Users')).toBe(false);
    });
  });

  describe('getParentPath', () => {
    it('navigates up Linux paths', () => {
      expect(getParentPath('/etc/nginx/conf.d')).toBe('/etc/nginx');
      expect(getParentPath('/etc/nginx')).toBe('/etc');
      expect(getParentPath('/etc')).toBe('/');
      expect(getParentPath('/')).toBe('/');
    });

    it('navigates up Windows paths without breaking on backslashes or drive roots', () => {
      expect(getParentPath('C:\\Users\\whh\\Documents')).toBe('C:/Users/whh');
      expect(getParentPath('C:/Users/whh')).toBe('C:/Users');
      expect(getParentPath('C:/Users')).toBe('C:/');
      expect(getParentPath('C:/')).toBe('C:/');
      expect(getParentPath('C:\\')).toBe('C:/');
    });
  });

  describe('joinPath', () => {
    it('joins POSIX segments safely', () => {
      expect(joinPath('/etc', 'nginx')).toBe('/etc/nginx');
      expect(joinPath('/', 'etc')).toBe('/etc');
      expect(joinPath('/etc/nginx', 'conf.d/default.conf')).toBe('/etc/nginx/conf.d/default.conf');
    });

    it('joins Windows segments safely without double slashes', () => {
      expect(joinPath('C:/Users/whh', 'test.txt')).toBe('C:/Users/whh/test.txt');
      expect(joinPath('C:/', 'test.txt')).toBe('C:/test.txt');
      expect(joinPath('C:\\', 'test.txt')).toBe('C:/test.txt');
    });
  });

  describe('getBaseName', () => {
    it('extracts filename or last directory name', () => {
      expect(getBaseName('/etc/nginx/nginx.conf')).toBe('nginx.conf');
      expect(getBaseName('C:\\Users\\whh\\test.txt')).toBe('test.txt');
      expect(getBaseName('C:/Users/whh')).toBe('whh');
      expect(getBaseName('/')).toBe('/');
      expect(getBaseName('C:/')).toBe('C:/');
    });
  });
});
