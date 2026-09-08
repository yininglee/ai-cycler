export type RideParseErrorCode =
  | "FILE_EMPTY"
  | "FILE_TOO_LARGE"
  | "FILE_HEADER_MISMATCH"
  | "UNSUPPORTED_FILE_TYPE"
  | "UNSUPPORTED_MIME_TYPE"
  | "FIT_INVALID_OR_CORRUPT"
  | "FIT_NO_CYCLING_SESSION"
  | "FIT_MULTIPLE_CYCLING_SESSIONS"
  | "FIT_TOO_MANY_RECORDS"
  | "GPX_UNSAFE_XML"
  | "GPX_INVALID_ENCODING"
  | "GPX_INVALID_XML"
  | "GPX_NO_TRACK_POINTS"
  | "GPX_TOO_MANY_TRACK_POINTS"
  | "GPX_INVALID_COORDINATES"
  | "GPX_IMPLAUSIBLE_TRACK";

export class RideParseError extends Error {
  readonly code: RideParseErrorCode;

  constructor(code: RideParseErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "RideParseError";
    this.code = code;
  }
}

export function isRideParseError(error: unknown): error is RideParseError {
  return error instanceof RideParseError;
}
