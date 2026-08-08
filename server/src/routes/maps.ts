import { Router } from 'express';
import type { RequestHandler } from 'express';
import multer from 'multer';
import os from 'node:os';
import { z } from 'zod';
import { env } from '../env.js';
import { ApiError, asyncHandler } from '../http/errors.js';
import { logger } from '../logger.js';
import { readSettings } from '../services/controlPanelSettings.js';
import {
  assertSafePk3Name,
  checksum,
  deleteMap,
  installUpload,
  listMaps,
  storageUsage,
} from '../services/maps.js';

export const mapsRouter = Router();

const MAX_FILES_PER_UPLOAD = 8;

/**
 * Uploads land in a temp directory first and are only moved into etmain once
 * the transfer completes, so an aborted upload can never leave a truncated pk3
 * where the game server or a downloading client would find it.
 *
 * Built per request rather than once at module load, because the size limit is
 * now editable from the control panel: a multer instance created at boot would hold
 * whatever the limit was then, and raising it would appear to do nothing until
 * the container was restarted.
 */
function uploadMiddleware(): RequestHandler {
  return (req, res, next) => {
    void readSettings()
      .then((settings) =>
        multer({
          dest: os.tmpdir(),
          limits: {
            fileSize: settings.maxUploadMb * 1024 * 1024,
            files: MAX_FILES_PER_UPLOAD,
          },
          fileFilter: (_request, file, cb) => {
            try {
              assertSafePk3Name(file.originalname);
              cb(null, true);
            } catch (err) {
              cb(err instanceof Error ? err : new Error('Rejected file'));
            }
          },
        }).array('files', MAX_FILES_PER_UPLOAD)(req, res, (err: unknown) => {
          if (!err) {
            next();
            return;
          }

          // Multer's own errors are the ones an operator can act on, and they
          // reached the generic handler as "Something went wrong" — useless
          // when the fix is a number they can change two clicks away.
          if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
              next(
                new ApiError(
                  413,
                  'file_too_large',
                  `That file is larger than the ${settings.maxUploadMb} MB upload limit. Raise it under Settings, or upload a smaller package.`,
                ),
              );
              return;
            }
            if (err.code === 'LIMIT_FILE_COUNT') {
              next(
                new ApiError(
                  400,
                  'too_many_files',
                  `Up to ${MAX_FILES_PER_UPLOAD} files can be uploaded at once.`,
                ),
              );
              return;
            }
          }

          // Anything else here is a fileFilter rejection, which already carries
          // a message written for the operator.
          next(
            new ApiError(
              400,
              'rejected_file',
              err instanceof Error ? err.message : 'The upload was rejected',
            ),
          );
        }),
      )
      .catch(next);
  };
}

mapsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [maps, usage] = await Promise.all([listMaps(), storageUsage()]);
    res.json({ maps, usage, directory: env.ETMAIN_PATH });
  }),
);

mapsRouter.post(
  '/upload',
  uploadMiddleware(),
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
