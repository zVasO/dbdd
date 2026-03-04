import { useConnectionStore } from "@/stores/connectionStore";
import { WelcomePage } from "@/pages/WelcomePage";
import { WorkspacePage } from "@/pages/WorkspacePage";
import { ErrorBoundary } from "@/components/ErrorBoundary";

function App() {
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);

  return (
    <ErrorBoundary>
      {activeConnectionId ? <WorkspacePage /> : <WelcomePage />}
    </ErrorBoundary>
  );
}

export default App;
