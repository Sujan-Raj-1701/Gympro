import logging
from logging.handlers import TimedRotatingFileHandler
import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.getenv('LOG_FILE', 'app.log')
# If LOG_FILE is not absolute, place it inside fastapi_backend directory so path: M:\salon pos\fastapi_backend\app.log
if not os.path.isabs(LOG_FILE):
    LOG_FILE = os.path.join(BASE_DIR, LOG_FILE)
LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
LOG_MAX_BYTES = int(os.getenv('LOG_MAX_BYTES', 5 * 1024 * 1024))  # 5 MB
LOG_BACKUP_COUNT = int(os.getenv('LOG_BACKUP_COUNT', 7))  # Keep 7 days/files

# Allow override; default includes full path + line for direct code mapping
LOG_FORMAT = os.getenv('LOG_FORMAT', '%(asctime)s [%(levelname)s] %(pathname)s:%(lineno)d %(message)s')


class SizedTimedRotatingFileHandler(TimedRotatingFileHandler):
    """A single handler that rotates at midnight and also when the file exceeds maxBytes.

    Using one file handle avoids Windows rename conflicts that occur when two handlers
    write to and attempt to rotate the same file concurrently.
    """
    def __init__(self, filename, when='midnight', interval=1, backupCount=7, encoding='utf-8', delay=True, utc=False, atTime=None, maxBytes=0):
        self.maxBytes = int(maxBytes or 0)
        super().__init__(filename, when=when, interval=interval, backupCount=backupCount, encoding=encoding, delay=delay, utc=utc, atTime=atTime)

    def shouldRollover(self, record):
        # Time-based check from parent
        if super().shouldRollover(record):
            return 1
        # Size-based check
        if self.maxBytes > 0:
            try:
                msg = f"{self.format(record)}\n"
            except Exception:
                # Fallback to raw message length
                msg = f"{record.getMessage()}\n"
            try:
                if self.stream is None:
                    self.stream = self._open()
                # Estimate bytes including encoding
                enc = getattr(self, 'encoding', None) or 'utf-8'
                cur_size = self.stream.tell()
                projected = cur_size + len(msg.encode(enc, errors='ignore'))
                if projected >= self.maxBytes:
                    return 1
            except Exception:
                # On error, do not block logging; skip size rollover
                return 0
        return 0


def get_logger(name: str = 'app'):
    # Convert LOG_LEVEL to a numeric logging level if needed
    try:
        numeric_level = getattr(logging, LOG_LEVEL.upper()) if isinstance(LOG_LEVEL, str) else int(LOG_LEVEL)
    except Exception:
        numeric_level = logging.INFO

    # Build handlers on the ROOT logger to avoid duplicate messages
    formatter = logging.Formatter(LOG_FORMAT)
    root_logger = logging.getLogger()
    root_logger.handlers = []
    root_logger.setLevel(numeric_level)

    try:
        # Ensure directory exists for file logging
        try:
            dirname = os.path.dirname(LOG_FILE)
            if dirname:
                os.makedirs(dirname, exist_ok=True)
        except Exception:
            pass

        file_handler = SizedTimedRotatingFileHandler(
            LOG_FILE,
            when='midnight',
            backupCount=LOG_BACKUP_COUNT,
            encoding='utf-8',
            delay=True,
            maxBytes=LOG_MAX_BYTES,
        )
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)

        # Console mirror enabled by default so logs print even without debug
        if os.getenv('LOG_CONSOLE', '1') == '1':
            console = logging.StreamHandler(sys.stdout)
            console.setFormatter(formatter)
            root_logger.addHandler(console)

        # Configure common server loggers to propagate to root
        for lname in ('uvicorn', 'uvicorn.access', 'uvicorn.error', 'fastapi', 'gunicorn', 'gunicorn.error'):
            try:
                l = logging.getLogger(lname)
                l.setLevel(numeric_level)
                l.propagate = True
            except Exception:
                pass
    except Exception as e:
        # Fallback to console handler so logging doesn't fail startup
        print(f"[logger] falling back to stdout: {e}", file=sys.stderr)
        console = logging.StreamHandler(sys.stdout)
        console.setFormatter(formatter)
        root_logger.handlers = []
        root_logger.addHandler(console)
        root_logger.setLevel(numeric_level)

    # Return a named logger that uses the root handlers
    logger = logging.getLogger(name)
    logger.setLevel(numeric_level)
    logger.handlers = []  # ensure no per-logger handlers to prevent duplicates
    logger.propagate = True
    return logger