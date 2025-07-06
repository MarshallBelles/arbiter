import { FileWatchTrigger } from '../triggers/file-watch-trigger';
import { EventTrigger, ArbiterEvent } from '@arbiter/core';

// Mock chokidar
jest.mock('chokidar', () => ({
  watch: jest.fn(),
}));

// Mock logger
jest.mock('@arbiter/core', () => ({
  ...jest.requireActual('@arbiter/core'),
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
}));

const mockChokidar = require('chokidar');

describe('FileWatchTrigger', () => {
  let fileWatchTrigger: FileWatchTrigger;
  let mockCallback: jest.Mock;
  let mockWatcher: any;

  beforeEach(() => {
    fileWatchTrigger = new FileWatchTrigger();
    mockCallback = jest.fn();
    mockWatcher = {
      on: jest.fn(),
      close: jest.fn(),
    };
    
    // Reset mocks
    jest.clearAllMocks();
    mockChokidar.watch.mockReturnValue(mockWatcher);
  });

  describe('constructor', () => {
    it('should create a new file watch trigger instance', () => {
      expect(fileWatchTrigger).toBeInstanceOf(FileWatchTrigger);
    });

    it('should initialize with empty watchers', () => {
      const watchers = fileWatchTrigger.getWatchers();
      expect(watchers).toHaveLength(0);
    });
  });

  describe('register', () => {
    const createFileWatchTrigger = (
      path: string = '/test/path',
      events: string[] = ['created', 'modified', 'deleted'],
      pattern?: string
    ): EventTrigger => ({
      type: 'file-watch',
      config: {
        fileWatch: {
          path,
          events,
          pattern,
        },
      },
    });

    it('should register a file watcher', async () => {
      const trigger = createFileWatchTrigger();

      await fileWatchTrigger.register(trigger, mockCallback);

      expect(mockChokidar.watch).toHaveBeenCalledWith('/test/path', {
        ignored: /^\./,
        persistent: true,
        followSymlinks: false,
      });

      expect(mockWatcher.on).toHaveBeenCalledWith('add', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('addDir', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('change', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('unlink', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('unlinkDir', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should register watcher with specific events', async () => {
      const trigger = createFileWatchTrigger('/test/path', ['created']);

      await fileWatchTrigger.register(trigger, mockCallback);

      expect(mockWatcher.on).toHaveBeenCalledWith('add', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('addDir', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('error', expect.any(Function));

      // Should not register for modified or deleted events
      expect(mockWatcher.on).not.toHaveBeenCalledWith('change', expect.any(Function));
      expect(mockWatcher.on).not.toHaveBeenCalledWith('unlink', expect.any(Function));
      expect(mockWatcher.on).not.toHaveBeenCalledWith('unlinkDir', expect.any(Function));
    });

    it('should throw error for invalid trigger type', async () => {
      const trigger: EventTrigger = {
        type: 'webhook',
        config: {},
      };

      await expect(fileWatchTrigger.register(trigger, mockCallback)).rejects.toThrow(
        'Invalid trigger type for file watch trigger'
      );
    });

    it('should throw error for missing file watch configuration', async () => {
      const trigger: EventTrigger = {
        type: 'file-watch',
        config: {},
      };

      await expect(fileWatchTrigger.register(trigger, mockCallback)).rejects.toThrow(
        'File watch configuration is required'
      );
    });

    it('should track registered watchers', async () => {
      const trigger = createFileWatchTrigger();

      await fileWatchTrigger.register(trigger, mockCallback);

      const watchers = fileWatchTrigger.getWatchers();
      expect(watchers).toHaveLength(1);
      expect(watchers[0]).toMatch(/^watcher_\d+_[a-z0-9]+$/);
    });

    it('should handle file created event', async () => {
      const trigger = createFileWatchTrigger();
      let addHandler: Function;

      mockWatcher.on.mockImplementation((event, handler) => {
        if (event === 'add') {
          addHandler = handler;
        }
      });

      await fileWatchTrigger.register(trigger, mockCallback);

      // Simulate file creation
      await addHandler('/test/path/newfile.txt');

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(/^file_\d+_[a-z0-9]+$/),
          type: 'file-watch',
          source: 'file-watch:/test/path/newfile.txt',
          timestamp: expect.any(Date),
          data: {
            eventType: 'created',
            filePath: '/test/path/newfile.txt',
            fileName: 'newfile.txt',
            fileExtension: 'txt',
          },
          metadata: {
            watcherId: expect.stringMatching(/^watcher_\d+_[a-z0-9]+$/),
            eventType: 'created',
            filePath: '/test/path/newfile.txt',
          },
        })
      );
    });

    it('should handle file modified event', async () => {
      const trigger = createFileWatchTrigger();
      let changeHandler: Function;

      mockWatcher.on.mockImplementation((event, handler) => {
        if (event === 'change') {
          changeHandler = handler;
        }
      });

      await fileWatchTrigger.register(trigger, mockCallback);

      // Simulate file modification
      await changeHandler('/test/path/modified.txt');

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            eventType: 'modified',
            filePath: '/test/path/modified.txt',
            fileName: 'modified.txt',
            fileExtension: 'txt',
          },
        })
      );
    });

    it('should handle file deleted event', async () => {
      const trigger = createFileWatchTrigger();
      let unlinkHandler: Function;

      mockWatcher.on.mockImplementation((event, handler) => {
        if (event === 'unlink') {
          unlinkHandler = handler;
        }
      });

      await fileWatchTrigger.register(trigger, mockCallback);

      // Simulate file deletion
      await unlinkHandler('/test/path/deleted.txt');

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            eventType: 'deleted',
            filePath: '/test/path/deleted.txt',
            fileName: 'deleted.txt',
            fileExtension: 'txt',
          },
        })
      );
    });

    it('should handle callback errors gracefully', async () => {
      const trigger = createFileWatchTrigger();
      mockCallback.mockRejectedValue(new Error('Callback error'));
      let addHandler: Function;

      mockWatcher.on.mockImplementation((event, handler) => {
        if (event === 'add') {
          addHandler = handler;
        }
      });

      await fileWatchTrigger.register(trigger, mockCallback);

      // Simulate file creation with error
      await expect(addHandler('/test/path/newfile.txt')).resolves.not.toThrow();
      expect(mockCallback).toHaveBeenCalled();
    });

    it('should handle watcher errors', async () => {
      const trigger = createFileWatchTrigger();
      let errorHandler: Function;

      mockWatcher.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          errorHandler = handler;
        }
      });

      await fileWatchTrigger.register(trigger, mockCallback);

      // Simulate watcher error
      errorHandler(new Error('Watcher error'));

      // Should not throw, just log the error
      expect(mockWatcher.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('unregister', () => {
    it('should unregister file watchers', async () => {
      const trigger: EventTrigger = {
        type: 'file-watch',
        config: {
          fileWatch: {
            path: '/test/path',
            events: ['created'],
          },
        },
      };

      await fileWatchTrigger.register(trigger, mockCallback);
      await fileWatchTrigger.unregister(trigger);

      expect(mockWatcher.close).toHaveBeenCalled();
      const watchers = fileWatchTrigger.getWatchers();
      expect(watchers).toHaveLength(0);
    });

    it('should handle missing file watch configuration', async () => {
      const trigger: EventTrigger = {
        type: 'file-watch',
        config: {},
      };

      await expect(fileWatchTrigger.unregister(trigger)).resolves.not.toThrow();
    });
  });

  describe('start', () => {
    it('should start the file watch trigger', () => {
      expect(() => fileWatchTrigger.start()).not.toThrow();
    });
  });

  describe('stop', () => {
    it('should stop all file watchers', async () => {
      const trigger: EventTrigger = {
        type: 'file-watch',
        config: {
          fileWatch: {
            path: '/test/path',
            events: ['created'],
          },
        },
      };

      await fileWatchTrigger.register(trigger, mockCallback);
      await fileWatchTrigger.stop();

      expect(mockWatcher.close).toHaveBeenCalled();
      const watchers = fileWatchTrigger.getWatchers();
      expect(watchers).toHaveLength(0);
    });

    it('should handle empty watcher list', async () => {
      await expect(fileWatchTrigger.stop()).resolves.not.toThrow();
    });
  });

  describe('getWatchers', () => {
    it('should return watcher IDs for registered watchers', async () => {
      const trigger1: EventTrigger = {
        type: 'file-watch',
        config: {
          fileWatch: {
            path: '/test/path1',
            events: ['created'],
          },
        },
      };

      const trigger2: EventTrigger = {
        type: 'file-watch',
        config: {
          fileWatch: {
            path: '/test/path2',
            events: ['modified'],
          },
        },
      };

      await fileWatchTrigger.register(trigger1, mockCallback);
      await fileWatchTrigger.register(trigger2, mockCallback);

      const watchers = fileWatchTrigger.getWatchers();
      expect(watchers).toHaveLength(2);
      expect(watchers.every(watcher => watcher.startsWith('watcher_'))).toBe(true);
    });
  });

  describe('generateEventId', () => {
    it('should generate unique event IDs', () => {
      const trigger = fileWatchTrigger as any;
      const id1 = trigger.generateEventId();
      const id2 = trigger.generateEventId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^file_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^file_\d+_[a-z0-9]+$/);
    });
  });

  describe('edge cases', () => {
    const createFileWatchTrigger = (
      path: string = '/test/path',
      events: string[] = ['created', 'modified', 'deleted'],
      pattern?: string
    ): EventTrigger => ({
      type: 'file-watch',
      config: {
        fileWatch: {
          path,
          events,
          pattern,
        },
      },
    });

    it('should handle files without extensions', async () => {
      const trigger = createFileWatchTrigger();
      let addHandler: Function;

      mockWatcher.on.mockImplementation((event, handler) => {
        if (event === 'add') {
          addHandler = handler;
        }
      });

      await fileWatchTrigger.register(trigger, mockCallback);

      // Simulate file creation without extension
      await addHandler('/test/path/README');

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            eventType: 'created',
            filePath: '/test/path/README',
            fileName: 'README',
            fileExtension: 'README',
          },
        })
      );
    });

    it('should handle deep file paths', async () => {
      const trigger = createFileWatchTrigger();
      let addHandler: Function;

      mockWatcher.on.mockImplementation((event, handler) => {
        if (event === 'add') {
          addHandler = handler;
        }
      });

      await fileWatchTrigger.register(trigger, mockCallback);

      // Simulate file creation in deep path
      await addHandler('/test/path/deep/nested/folder/file.txt');

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            eventType: 'created',
            filePath: '/test/path/deep/nested/folder/file.txt',
            fileName: 'file.txt',
            fileExtension: 'txt',
          },
        })
      );
    });

    it('should handle directory events', async () => {
      const trigger = createFileWatchTrigger();
      let addDirHandler: Function;

      mockWatcher.on.mockImplementation((event, handler) => {
        if (event === 'addDir') {
          addDirHandler = handler;
        }
      });

      await fileWatchTrigger.register(trigger, mockCallback);

      // Simulate directory creation
      await addDirHandler('/test/path/newdir');

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            eventType: 'created',
            filePath: '/test/path/newdir',
            fileName: 'newdir',
            fileExtension: 'newdir',
          },
        })
      );
    });

    it('should handle multiple watchers on same path', async () => {
      const trigger: EventTrigger = {
        type: 'file-watch',
        config: {
          fileWatch: {
            path: '/test/path',
            events: ['created'],
          },
        },
      };

      await fileWatchTrigger.register(trigger, mockCallback);
      await fileWatchTrigger.register(trigger, mockCallback);

      const watchers = fileWatchTrigger.getWatchers();
      expect(watchers).toHaveLength(2);
    });
  });
});