import { assertEquals, assertRejects } from '@std/assert';
import { SpanStatusCode, trace, type TracerProvider } from '@opentelemetry/api';
import { configureServiceName, withSpan } from './otel.ts';
import { operationId, repositoryId } from '@yoroi/domain';

/**
 * No real OTel SDK (`@opentelemetry/sdk-trace-node`) is a dependency of this
 * package — `withSpan`'s job is just to call the right `Span`/`Tracer` API
 * methods correctly, so a minimal fake provider that records what was called
 * is enough to test it without pulling in a full exporter/processor stack.
 */

class RecordingSpan {
	readonly attributes: Record<string, unknown> = {};
	readonly exceptions: unknown[] = [];
	readonly statuses: unknown[] = [];
	ended = false;

	setAttribute(key: string, value: unknown): this {
		this.attributes[key] = value;
		return this;
	}
	setAttributes(attrs: Record<string, unknown>): this {
		Object.assign(this.attributes, attrs);
		return this;
	}
	recordException(exception: unknown): void {
		this.exceptions.push(exception);
	}
	setStatus(status: unknown): this {
		this.statuses.push(status);
		return this;
	}
	end(): void {
		this.ended = true;
	}
	spanContext() {
		return { traceId: '', spanId: '', traceFlags: 0 };
	}
	addEvent(): this {
		return this;
	}
	addLink(): this {
		return this;
	}
	addLinks(): this {
		return this;
	}
	updateName(): this {
		return this;
	}
	isRecording(): boolean {
		return true;
	}
}

class RecordingTracer {
	lastSpan: RecordingSpan | null = null;

	startActiveSpan(_name: string, fn: (span: unknown) => unknown): unknown {
		const span = new RecordingSpan();
		this.lastSpan = span;
		return fn(span);
	}
	startSpan(): never {
		throw new Error('RecordingTracer.startSpan: not used by withSpan');
	}
}

class RecordingTracerProvider {
	readonly tracer = new RecordingTracer();
	getTracer(): unknown {
		return this.tracer;
	}
}

function install(): RecordingTracerProvider {
	// @opentelemetry/api's global registration only accepts the *first*
	// `setGlobalTracerProvider` call per process and silently ignores later
	// ones — `disable()` first so each test gets its own fresh provider
	// rather than every test after the first silently reusing test #1's.
	trace.disable();
	const provider = new RecordingTracerProvider();
	trace.setGlobalTracerProvider(provider as unknown as TracerProvider);
	return provider;
}

Deno.test('withSpan: yoroi.*属性を正しくSpanへ設定する', async () => {
	const provider = install();
	configureServiceName('test-service');

	await withSpan(
		'evaluate_policy',
		{
			operationId: operationId('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
			repositoryId: repositoryId(42)
		},
		(span: unknown) => {
			assertEquals(
				(span as RecordingSpan).attributes['yoroi.operation_id'],
				'01ARZ3NDEKTSV4RRFFQ69G5FAV'
			);
			return Promise.resolve('ok');
		}
	);

	const span = provider.tracer.lastSpan!;
	assertEquals(span.attributes['yoroi.repository_id'], 42);
	assertEquals(span.ended, true);
});

Deno.test('withSpan: fnの戻り値をそのまま返す', async () => {
	install();
	const result = await withSpan('noop', {}, () => Promise.resolve(123));
	assertEquals(result, 123);
});

Deno.test(
	'withSpan: fnが例外を投げたらrecordException+ERROR statusを記録し、そのままrethrowする',
	async () => {
		const provider = install();
		const boom = new Error('boom');

		await assertRejects(
			() =>
				withSpan('failing_step', {}, () => {
					throw boom;
				}),
			Error,
			'boom'
		);

		const span = provider.tracer.lastSpan!;
		assertEquals(span.exceptions, [boom]);
		assertEquals(span.statuses, [{ code: SpanStatusCode.ERROR }]);
		assertEquals(span.ended, true);
	}
);

Deno.test('withSpan: attrsを省略したフィールドはSpanに設定されない', async () => {
	const provider = install();
	await withSpan('minimal', {}, () => Promise.resolve(undefined));
	const span = provider.tracer.lastSpan!;
	assertEquals('yoroi.operation_id' in span.attributes, false);
	assertEquals('yoroi.candidate_sha' in span.attributes, false);
});

Deno.test(
	'withSpan: DENO_DEPLOYMENT_IDが設定されていればyoroi.deno_revision_idを記録する',
	async () => {
		const provider = install();
		const original = Deno.env.get('DENO_DEPLOYMENT_ID');
		Deno.env.set('DENO_DEPLOYMENT_ID', 'rev-abc123');
		try {
			await withSpan('with_revision', {}, () => Promise.resolve(undefined));
		} finally {
			if (original === undefined) Deno.env.delete('DENO_DEPLOYMENT_ID');
			else Deno.env.set('DENO_DEPLOYMENT_ID', original);
		}
		const span = provider.tracer.lastSpan!;
		assertEquals(span.attributes['yoroi.deno_revision_id'], 'rev-abc123');
	}
);
