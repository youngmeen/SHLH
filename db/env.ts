/**
 * 워커가 요청마다 받은 바인딩을 여기에 둔다.
 *
 * `cloudflare:workers`에서 직접 import하지 않는 이유는, 그 모듈이 워커 런타임에만
 * 존재해서 서버 번들을 순수 Node로 불러오는 테스트(tests/rendered-html.test.mjs)가
 * 로드 단계에서 깨지기 때문이다. 진입점이 넣어주면 두 환경에서 모두 동작한다.
 */
export type WorkerBindings = {
  DB?: D1Database;
};

let bindings: WorkerBindings | null = null;

export function setWorkerBindings(next: unknown) {
  bindings = (next ?? null) as WorkerBindings | null;
}

export function getWorkerBindings(): WorkerBindings | null {
  return bindings;
}
