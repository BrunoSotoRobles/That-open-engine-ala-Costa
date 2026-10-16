import * as React from "react";
import * as BUI from "@thatopen/ui";

interface Props {
  onChange: (value: string) => void
}

export function SearchBox(props: Props) {
  const searchInputRef = React.useRef<BUI.TextInput | null>(null);

  React.useEffect(() => {
    const searchInput = searchInputRef.current;
    if (!searchInput) return;

    const handleInput = () => {
      props.onChange(searchInput.value);
    };

    searchInput.addEventListener("input", handleInput);
    return () => {
      searchInput.removeEventListener("input", handleInput);
    };
  }, [props.onChange]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        columnGap: 10,
        width: "40%",
      }}
    >
      <bim-text-input 
        placeholder="Search" 
        ref={searchInputRef}
      ></bim-text-input>
    </div>
  );
}