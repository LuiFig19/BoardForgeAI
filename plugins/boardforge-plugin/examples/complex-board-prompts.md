# BoardForge Complex Board Prompts

Use these prompts in Codex after the BoardForge plugin/MCP server is available. Codex should call BoardForge tools with structured JSON, not edit KiCad files directly.

## Compact HDI Wearable

```text
Use BoardForge to plan a 6-layer compact BLE wearable PCB, 24 mm x 18 mm, USB-C debug, LiPo charger, RF antenna keepout, dense passives, and allow blind vias/microvias only if the manufacturer profile supports them. First run plan_requirements, then plan_stackup, then plan_complex_board. Do not create manufacturing exports until ERC/DRC and advanced fab review pass.
```

## Large Robotics Controller

```text
Use BoardForge to plan a 4-layer robotics controller, 130 mm x 90 mm, battery input, motor drivers, CAN, USB debug, I2C sensors, SWD, thermal MOSFET zones, and JLCPCB standard rules. Prefer standard through vias, wide power copper, continuous ground reference, and keep heat away from sensors.
```

## ESP32-S3 PoE Sensor

```text
Use BoardForge to create an ESP32-S3 PoE Ethernet sensor board with RJ45 MagJack, USB-C debug, I2C sensor connector, SWD, 3V3 regulator, 4 layers, 70 mm x 45 mm, JLCPCB. Plan requirements, stackup, assembly/mechanical access, placement intent, routing/via strategy, then create the KiCad project.
```

## Manufacturer Comparison

```text
Use BoardForge compare_manufacturers for a dense 6-layer USB/Ethernet/RF board with possible blind vias and microvias. Tell me which manufacturer profile blocks the design, which needs advanced quote review, and which is the safest profile to choose.
```
