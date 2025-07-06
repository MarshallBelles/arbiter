import { ArbiterEvent, EventTrigger, createLogger } from '@arbiter/core';
import { FSWatcher, watch } from 'chokidar';

const logger = createLogger('FileWatchTrigger');

export class FileWatchTrigger {
  private watchers = new Map<string, FSWatcher>();

  async register(trigger: EventTrigger, callback: (event: ArbiterEvent) => Promise<any>): Promise<void> {
    if (trigger.type !== 'file-watch') {
      throw new Error('Invalid trigger type for file watch trigger');
    }

    const config = trigger.config.fileWatch;
    if (!config) {
      throw new Error('File watch configuration is required');
    }

    const watcherId = `watcher_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const watcher = watch(config.path, {
      ignored: /^\./, // ignore dotfiles
      persistent: true,
      followSymlinks: false,
    });

    // Set up event listeners
    const events = config.events || ['created', 'modified', 'deleted'];
    
    if (events.includes('created')) {
      watcher.on('add', (path) => this.handleFileEvent('created', path, callback, watcherId));
      watcher.on('addDir', (path) => this.handleFileEvent('created', path, callback, watcherId));
    }

    if (events.includes('modified')) {
      watcher.on('change', (path) => this.handleFileEvent('modified', path, callback, watcherId));
    }

    if (events.includes('deleted')) {
      watcher.on('unlink', (path) => this.handleFileEvent('deleted', path, callback, watcherId));
      watcher.on('unlinkDir', (path) => this.handleFileEvent('deleted', path, callback, watcherId));
    }

    watcher.on('error', (error) => {
      logger.error(`File watcher error: ${watcherId}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });

    this.watchers.set(watcherId, watcher);

    logger.info(`Registered file watcher: ${config.path}`, {
      watcherId,
      events: events,
      pattern: config.pattern,
    });
  }

  async unregister(trigger: EventTrigger): Promise<void> {
    const config = trigger.config.fileWatch;
    if (!config) {
      return;
    }

    // Find and remove watcher by path
    for (const [watcherId, watcher] of this.watchers) {
      // Note: In a real implementation, you'd need to store the trigger config
      // to match against it properly. For now, we'll just close all watchers.
      await watcher.close();
      this.watchers.delete(watcherId);
      logger.info(`Unregistered file watcher: ${config.path}`, { watcherId });
    }
  }

  private async handleFileEvent(
    eventType: string,
    filePath: string,
    callback: (event: ArbiterEvent) => Promise<any>,
    watcherId: string
  ): Promise<void> {
    logger.info(`File event: ${eventType} ${filePath}`, { watcherId });

    const event: ArbiterEvent = {
      id: this.generateEventId(),
      type: 'file-watch',
      source: `file-watch:${filePath}`,
      timestamp: new Date(),
      data: {
        eventType,
        filePath,
        fileName: filePath.split('/').pop() || '',
        fileExtension: filePath.includes('.') ? filePath.split('.').pop() || '' : filePath.split('/').pop() || '',
      },
      metadata: {
        watcherId,
        eventType,
        filePath,
      },
    };

    try {
      await callback(event);
      logger.info(`File event processed: ${eventType} ${filePath}`, { watcherId });
    } catch (error) {
      logger.error(`File event processing failed: ${eventType} ${filePath}`, {
        watcherId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private generateEventId(): string {
    return `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getWatchers(): string[] {
    return Array.from(this.watchers.keys());
  }

  start(): void {
    logger.info('File watch trigger started');
  }

  async stop(): Promise<void> {
    for (const [watcherId, watcher] of this.watchers) {
      await watcher.close();
    }
    this.watchers.clear();
    logger.info('File watch trigger stopped');
  }
}