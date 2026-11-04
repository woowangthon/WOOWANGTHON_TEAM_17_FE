import EntryPage from '../pages/EntryPage';
import UiPreviewPage from '../pages/UiPreviewPage';

export default function App() {
  return new URLSearchParams(window.location.search).get('preview') === 'ui' ? <UiPreviewPage /> : <EntryPage />;
}
