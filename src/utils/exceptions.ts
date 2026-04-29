export class HttpException extends Error {
  constructor(
    public override message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, HttpException.prototype);
  }
}

export class BadRequestException extends HttpException {
  constructor(message = 'Bad Request') {
    super(message, 400);
    Object.setPrototypeOf(this, BadRequestException.prototype);
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message = 'Unauthorized') {
    super(message, 401);
    Object.setPrototypeOf(this, UnauthorizedException.prototype);
  }
}

export class ForbiddenException extends HttpException {
  constructor(message = 'Forbidden') {
    super(message, 403);
    Object.setPrototypeOf(this, ForbiddenException.prototype);
  }
}

export class NotFoundException extends HttpException {
  constructor(message = 'Not Found') {
    super(message, 404);
    Object.setPrototypeOf(this, NotFoundException.prototype);
  }
}

export class ConflictException extends HttpException {
  constructor(message = 'Conflict') {
    super(message, 409);
    Object.setPrototypeOf(this, ConflictException.prototype);
  }
}

export class UnprocessableEntityException extends HttpException {
  constructor(message = 'Unprocessable Entity') {
    super(message, 422);
    Object.setPrototypeOf(this, UnprocessableEntityException.prototype);
  }
}

export class InternalServerErrorException extends HttpException {
  constructor(message = 'Internal Server Error') {
    super(message, 500);
    Object.setPrototypeOf(this, InternalServerErrorException.prototype);
  }
}
