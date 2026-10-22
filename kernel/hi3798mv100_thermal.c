// SPDX-License-Identifier: GPL-2.0-only
/*
 * HiSilicon Hi3798MV100 thermal sensor driver
 *
 * The sensor lives in the PMOC block.  Writing PMC10 starts a conversion;
 * PMC12..PMC15 then hold eight 10-bit samples that average to a code between
 * 125 (minus 40 C) and 931 (125 C).
 */

#include <linux/delay.h>
#include <linux/io.h>
#include <linux/module.h>
#include <linux/of.h>
#include <linux/platform_device.h>
#include <linux/thermal.h>

/* The DT reg starts at PMC10, so these offsets are relative to it. */
#define HI3798MV100_PMC10		0x00
#define HI3798MV100_PMC12		0x08
#define HI3798MV100_PMC10_START		0x6005
#define HI3798MV100_TEMP_MASK		0x3ff
#define HI3798MV100_TEMP_SAMPLES	8

struct hi3798mv100_thermal {
	void __iomem *pmoc;
};

static int hi3798mv100_thermal_get_temp(struct thermal_zone_device *tz, int *temp)
{
	struct hi3798mv100_thermal *priv = thermal_zone_device_priv(tz);
	u32 sum = 0, val;
	int i, t;

	writel(HI3798MV100_PMC10_START, priv->pmoc + HI3798MV100_PMC10);
	msleep(16);

	for (i = 0; i < 4; i++) {
		val = readl(priv->pmoc + HI3798MV100_PMC12 + i * 4);
		sum += val & HI3798MV100_TEMP_MASK;
		sum += (val >> 16) & HI3798MV100_TEMP_MASK;
	}

	writel(0, priv->pmoc + HI3798MV100_PMC10);

	t = ((int)(sum / HI3798MV100_TEMP_SAMPLES) - 125) * 165 / 806 - 40;
	*temp = t * 1000;
	return 0;
}

static const struct thermal_zone_device_ops hi3798mv100_thermal_ops = {
	.get_temp = hi3798mv100_thermal_get_temp,
};

static int hi3798mv100_thermal_probe(struct platform_device *pdev)
{
	struct hi3798mv100_thermal *priv;
	struct thermal_zone_device *tzd;

	priv = devm_kzalloc(&pdev->dev, sizeof(*priv), GFP_KERNEL);
	if (!priv)
		return -ENOMEM;

	priv->pmoc = devm_platform_ioremap_resource(pdev, 0);
	if (IS_ERR(priv->pmoc))
		return PTR_ERR(priv->pmoc);

	tzd = devm_thermal_of_zone_register(&pdev->dev, 0, priv,
					    &hi3798mv100_thermal_ops);
	if (IS_ERR(tzd))
		return dev_err_probe(&pdev->dev, PTR_ERR(tzd),
				     "failed to register thermal zone\n");

	dev_info(&pdev->dev, "registered\n");
	return 0;
}

static const struct of_device_id hi3798mv100_thermal_of_match[] = {
	{ .compatible = "hisilicon,hi3798mv100-tsensor" },
	{}
};
MODULE_DEVICE_TABLE(of, hi3798mv100_thermal_of_match);

static struct platform_driver hi3798mv100_thermal_driver = {
	.probe = hi3798mv100_thermal_probe,
	.driver = {
		.name = "hi3798mv100-thermal",
		.of_match_table = hi3798mv100_thermal_of_match,
	},
};
module_platform_driver(hi3798mv100_thermal_driver);

MODULE_DESCRIPTION("HiSilicon Hi3798MV100 thermal sensor");
MODULE_LICENSE("GPL");
