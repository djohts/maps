import { parentPort } from 'worker_threads';
import { parseSector } from './sector-parser';

interface SectorParserWorkerTask {
  taskId: number;
  data: Uint8Array;
}

const port = parentPort;
if (!port) {
  throw new Error('sector parser worker requires a parent port');
}

port.on('message', (message: SectorParserWorkerTask) => {
  try {
    const buffer = Buffer.from(
      message.data.buffer,
      message.data.byteOffset,
      message.data.byteLength,
    );
    const sector = parseSector(buffer);
    port.postMessage({
      taskId: message.taskId,
      sector,
    });
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    port.postMessage({
      taskId: message.taskId,
      error: {
        name: e.name,
        message: e.message,
        stack: e.stack,
      },
    });
  }
});
