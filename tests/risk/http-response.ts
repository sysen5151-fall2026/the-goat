/** Test-only adapter for the API handler's NextResponse.json boundary. */
export class NextResponse extends Response {
  static override json(body: unknown, init?: ResponseInit) {
    const response = Response.json(body, init);
    return new NextResponse(response.body, response);
  }
}
