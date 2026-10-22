// SPDX-License-Identifier: GPL-2.0-only
/*
 * HiSilicon Hi3798MV100 thermal sensor driver
 *
 * The temperature sensor lives in the PMOC block.  It provides eight
 * 8-bit samples through two registers.  The vendor SDK converts their
 * average with a linear formula and applies a per-chip trim read from
 * OTP.
 */

#include <linux/bitops.h>
#include <linux/io.h>
#include <linux/iopoll.h>
#include <linux/module.h>
#include <linux/of.h>
#include <linux/platform_device.h>
#include <linux/thermal.h>

/* The DT reg starts at PMC10, so these offsets are relative to it. */
#define HI3798MV100_PMC10		0x00
#define HI3798MV100_PMC12		0x08
#define HI3798MV100_PMC10_START		0x07200000

#define HI3798MV100_OTP_CHANNEL_SEL	0x00
#define HI3798MV100_OTP_CPU_RW_CTRL	0x04
#define HI3798MV100_OTP_CTRL_STATUS	0x0c
#define HI3798MV100_OTP_RDATA		0x10
#define HI3798MV100_OTP_RADDR		0x18
#define HI3798MV100_OTP_MODE		0x20
#define HI3798MV100_OTP_TMP_TRIM	0x258
#define HI3798MV100_OTP_READY		BIT(0)
#define HI3798MV100_OTP_TIMING		0x34f

struct hi3798mv100_thermal {
	void __iomem *pmoc;
	u32 trim;
};

static int hi3798mv100_otp_read(void __iomem *otp, u32 addr, u32 *val)
{
	u32 status, ctrl;
	int ret;

	ret = readl_poll_timeout(otp + HI3798MV100_OTP_CTRL_STATUS, status,
				 status & HI3798MV100_OTP_READY, 10, 100000);
	if (ret)
		return ret;

	ctrl = readl(otp + HI3798MV100_OTP_CHANNEL_SEL);
	ctrl = (ctrl & ~GENMASK(1, 0)) | 2;
	writel(ctrl, otp + HI3798MV100_OTP_CHANNEL_SEL);

	ctrl = readl(otp + HI3798MV100_OTP_CPU_RW_CTRL);
	ctrl &= ~(BIT(0) | GENMASK(5, 4));
	ctrl |= BIT(1) | (2 << 4);
	writel(ctrl, otp + HI3798MV100_OTP_CPU_RW_CTRL);

	writel(readl(otp + HI3798MV100_OTP_MODE) | HI3798MV100_OTP_TIMING,
	       otp + HI3798MV100_OTP_MODE);
	writel(addr, otp + HI3798MV100_OTP_RADDR);

	ret = readl_poll_timeout(otp + HI3798MV100_OTP_CTRL_STATUS, status,
				 status & HI3798MV100_OTP_READY, 10, 100000);
	if (ret)
		return ret;

	*val = readl(otp + HI3798MV100_OTP_RDATA);
	return 0;
}

static int hi3798mv100_thermal_get_temp(struct thermal_zone_device *tz, int *temp)
{
	struct hi3798mv100_thermal *priv = thermal_zone_device_priv(tz);
	u32 sum = 0, val;
	int i, t;

	writel(HI3798MV100_PMC10_START, priv->pmoc + HI3798MV100_PMC10);

	for (i = 0; i < 2; i++) {
		val = readl(priv->pmoc + HI3798MV100_PMC12 + i * 4);
		sum += (val & 0xff) + ((val >> 8) & 0xff) +
		       ((val >> 16) & 0xff) + ((val >> 24) & 0xff);
	}

	if (sum == 0 || sum == 8 * 0xff)
		return -EIO;

	t = ((sum / 8) * 180) / 255 - 40;

	if (priv->trim & BIT(22))
		t -= (priv->trim >> 18) & 0xf;
	else
		t += (priv->trim >> 18) & 0xf;

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
	void __iomem *otp;
	u32 trim;
	int ret;

	priv = devm_kzalloc(&pdev->dev, sizeof(*priv), GFP_KERNEL);
	if (!priv)
		return -ENOMEM;

	priv->pmoc = devm_platform_ioremap_resource(pdev, 0);
	if (IS_ERR(priv->pmoc))
		return PTR_ERR(priv->pmoc);

	otp = devm_platform_ioremap_resource(pdev, 1);
	if (IS_ERR(otp)) {
		dev_warn(&pdev->dev, "OTP unavailable, temperature trim disabled\n");
	} else if (!hi3798mv100_otp_read(otp, HI3798MV100_OTP_TMP_TRIM, &trim) &&
		   trim != 0xffffffff) {
		priv->trim = trim;
	} else {
		dev_warn(&pdev->dev, "failed to read temperature trim from OTP\n");
	}

	writel(HI3798MV100_PMC10_START, priv->pmoc + HI3798MV100_PMC10);

	tzd = devm_thermal_of_zone_register(&pdev->dev, 0, priv,
					    &hi3798mv100_thermal_ops);
	if (IS_ERR(tzd))
		return dev_err_probe(&pdev->dev, PTR_ERR(tzd),
				     "failed to register thermal zone\n");

	dev_info(&pdev->dev, "registered, OTP trim %#x\n", priv->trim);
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
