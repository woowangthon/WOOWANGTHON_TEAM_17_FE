import Button from './Button';

type SharedProps = { title?: string; description?: string };
type AsyncStateProps =
  | (SharedProps & { status: 'loading' | 'empty' })
  | (SharedProps & { status: 'error'; onRetry: () => void; retryLabel?: string });

export default function AsyncState(props: AsyncStateProps) {
  const title = props.title ?? (props.status === 'loading' ? '불러오는 중' : props.status === 'empty' ? '표시할 내용이 없어요' : '내용을 불러오지 못했어요');
  const description = props.description ?? (props.status === 'loading' ? '잠시만 기다려 주세요.' : props.status === 'empty' ? '조건을 바꾸거나 새 항목을 추가해 보세요.' : '잠시 후 다시 시도해 주세요.');

  const content = (
    <div className={`async-state async-state-${props.status}`}>
      {props.status === 'loading' && <span className="async-state-spinner" aria-hidden="true" />}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {props.status === 'error' && <Button variant="secondary" onClick={props.onRetry}>{props.retryLabel ?? '다시 시도'}</Button>}
    </div>
  );

  if (props.status === 'loading') return <div role="status" aria-live="polite">{content}</div>;
  if (props.status === 'error') return <div role="alert">{content}</div>;
  return content;
}
