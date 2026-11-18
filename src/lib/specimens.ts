// Original contours use a shared 240 × 240 design space, with the baseline at y=200.
export const specimens = [
  {
    name: "Forma Serif", char: "a", style: "Display serif", color: "#e9bfd1", ink: "#461d33",
    path: "M 45 81 C 50 56 76 39 116 39 C 162 39 187 58 182 103 L 176 166 C 174 185 179 193 194 187 L 197 192 C 180 209 142 208 136 183 C 118 202 97 207 76 202 C 46 197 32 175 40 150 C 48 122 75 111 143 102 L 145 81 C 147 57 139 45 120 45 C 101 45 91 55 92 72 C 94 90 83 101 67 100 C 52 100 42 93 45 81 Z M 142 109 C 107 115 88 125 81 148 C 72 181 98 204 125 181 C 133 175 137 166 138 155 Z",
    anchor: [143,102], handles: [[119,105],[158,100]], code: "0061"
  },
  {
    name: "Axial Grotesk", char: "R", style: "Grotesk sans", color: "#cbd5b7", ink: "#273b2f",
    path: "M 48 200 L 48 35 L 129 35 C 169 35 190 55 190 88 C 190 113 177 130 154 138 L 199 200 L 154 200 L 115 143 L 85 143 L 85 200 Z M 85 67 L 85 112 L 125 112 C 144 112 153 104 153 89 C 153 75 143 67 124 67 Z",
    anchor: [190,88], handles: [[190,55],[190,113]], code:"0052"
  },
  {
    name: "Loop Script", char: "e", style: "Script italic", color: "#edc7a1", ink: "#50321e",
    path: "M 30 166 C 48 159 53 151 63 136 C 75 98 111 57 150 53 C 181 49 196 68 183 93 C 167 121 126 138 101 142 C 92 174 103 188 122 185 C 145 182 169 167 192 145 L 197 151 C 168 183 139 205 103 205 C 72 205 54 186 56 163 L 33 174 Z M 104 132 C 126 126 152 110 166 88 C 177 69 172 60 160 62 C 139 65 116 102 104 132 Z",
    anchor:[150,53], handles:[[111,57],[181,49]], code:"0065"
  },
  {
    name:"Orbit Symbols", char:"✳", style:"Vector symbol", color:"#bdc9df", ink:"#2e314e",
    path:"M 108 31 L 132 31 L 132 88 L 172 48 L 190 66 L 150 106 L 207 106 L 207 130 L 150 130 L 190 170 L 172 188 L 132 148 L 132 205 L 108 205 L 108 148 L 68 188 L 50 170 L 90 130 L 33 130 L 33 106 L 90 106 L 50 66 L 68 48 L 108 88 Z",
    anchor:[132,88], handles:[], code:"2733"
  }
] as const;
export type Specimen = (typeof specimens)[number];
