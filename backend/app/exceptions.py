from fastapi import HTTPException


class AppError(HTTPException):
    """Application-level error with HTTP status code."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(status_code=status_code, detail=message)
        self.message = message
