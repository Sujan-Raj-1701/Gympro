import MarketingAIDemo from "./MarketingAIDemo";
import { useEffect } from "react";
import { useContext } from "react";
import { HeaderContext } from "@/contexts/HeaderContext";
import MarketingAI from "./MarketingAI";

export default function MarketingPage() {
  const { setHeaderTitle } = useContext(HeaderContext);

  useEffect(() => {
    setHeaderTitle('Marketing AI');
    return () => setHeaderTitle('');
  }, [setHeaderTitle]);

  return <MarketingAI/>;
}