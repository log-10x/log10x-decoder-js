# Log10x Decoder for JavaScript

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![npm](https://img.shields.io/npm/v/@log10x/decoder.svg)](https://www.npmjs.com/package/@log10x/decoder)

JavaScript library for decoding [Log10x-encoded](https://doc.log10x.com/run/transform/#encoding) log events back to their original form. Log10x losslessly compacts log events by extracting recurring structure into templates and storing only the variable values — this library reverses that process.

Port of the [Java decoder](https://github.com/log-10x/log10x-decoder-java).

## Installation

```bash
npm install @log10x/decoder
```

## Usage

```javascript
import { decode } from '@log10x/decoder';

const original = decode(templatePattern, encodedEvent);
```

## Also Available

- **Java** — [log10x-decoder-java](https://github.com/log-10x/log10x-decoder-java) — Core library + CLI tool, Maven Central

## Building from Source

```bash
npm install
npm test
```

## Documentation

- [Log10x Documentation](https://doc.log10x.com)
- [Encoding & Decoding](https://doc.log10x.com/run/transform/#encoding)

## License

This repository is licensed under the [MIT License](LICENSE).

### Important: Log10x Product License Required

This repository contains a decoder library for Log10x-encoded events. While the decoder itself is open source, **using the Log10x Edge Optimizer to encode events requires a commercial license**.

| Component | License |
|-----------|---------|
| This repository (decoder library) | MIT (open source) |
| Log10x Edge Optimizer | Commercial license required |

**What this means:**
- You can freely use, modify, and distribute this decoder
- The Log10x Edge Optimizer that generates encoded events requires a paid subscription
- A valid Log10x license is required to run the Edge Optimizer

**Get Started:**
- [Log10x Pricing](https://log10x.com/pricing)
- [Documentation](https://doc.log10x.com)
- [Contact Sales](mailto:sales@log10x.com)

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests to the repository.

## Support

For issues and feature requests:
- Open an issue on [GitHub](https://github.com/log-10x/log10x-decoder-js/issues)
- Contact the Log10x team at [support@log10x.com](mailto:support@log10x.com)
