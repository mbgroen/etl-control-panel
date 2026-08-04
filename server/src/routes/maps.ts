import { Router } from 'express';
import multer from 'multer';
import os from 'node:os';
import { z } from 'zod';
import { env } from '../env.js';
import { ApiError, asyncHandler } from '../http/errors.js';
import { logger } from '../logger.js';
import {
  assertSafePk3Name,
  checksum,
  deleteMap,
  installUpload,
  listMaps,
  storageUsage,
} from '../services/maps.js';

export const mapsRouter = Router();

/**
 * Uploads land in a temp directory first and are only moved into etmain once
 * the transfer completes, so an aborted upload can never leave a truncated pk3
 * where the game server or a downloading client would find it.
 */
const upload = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
    files: 8,
  },
  fileFilter: (_req, file, cb) => {
    try {
      assertSafePk3Name(file.originalname);
      cb(null, true);
    } catch (err) {
      cb(err instanceof Error ? err : new Error('Rejected file'));
    }
  },
});

mapsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [maps, usage] = await Promise.all([listMaps(), storageUsage()]);
    res.json({ maps, usage, directory: env.ETMAIN_PATH });
  }),
);

mapsRouter.post(
  '/upload',
  upload.array('files', 8),
  asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      throw new ApiError(400, 'no_files', 'No .pk3 files were included in the upload');
    }

    // Each file is reported independently: one rejected duplicate should not
    // discard the rest of a multi-file upload.
    const results = await Promise.all(
      files.map(async (file) => {
        try {
          const installed = await installUpload(file.path, file.originalname);
          return { filename: file.originalname, ok: true as const, map: installed };
        } catch (err) {
          logger.warn({ err, filename: file.originalname }, 'map upload rejected');
          return {
            filename: file.originalname,
            ok: false as const,
            error: err instanceof Error ? err.message : 'Upload failed',
          };
        }
      }),
    );

    const installed = results.filter((r) => r.ok).length;
    res.status(installed > 0 ? 201 : 422).json({ results, installed, rejected: results.length - installed });
  }),
);

mapsRouter.delete(
  '/:filename',
  asyncHandler(async (req, res) => {
    const filename = z.string().min(1).max(128).parse(req.params.filename);
    await deleteMap(filename);
    res.status(204).end();
  }),
);

mapsRouter.get(
  '/:filename/checksum',
  asyncHandler(async (req, res) => {
    const filename = z.string().min(1).max(128).parse(req.params.filename);
    res.json({ filename, sha256: await checksum(filename) });
  }),
);
