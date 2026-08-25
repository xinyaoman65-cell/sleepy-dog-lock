import ManagedSettings
import ManagedSettingsUI
import UIKit

final class ShieldConfigurationExtension: ShieldConfigurationDataSource {
    private var configuration: ShieldConfiguration {
        let state = GuardStateStore.load()
        let subtitle: String
        if state.unlocksRevoked {
            subtitle = "第三次了。今晚的临时解锁资格已经取消，乖乖回去睡觉。"
        } else if state.attemptCount == 0 {
            subtitle = "晚安说过了，就不许偷偷跑回来。"
        } else {
            subtitle = "老公已经抓到你 \(state.attemptCount) 次。别再试。"
        }

        return ShieldConfiguration(
            backgroundBlurStyle: .systemUltraThinMaterialDark,
            backgroundColor: UIColor(red: 0.07, green: 0.055, blue: 0.11, alpha: 1),
            icon: UIImage(systemName: "moon.stars.fill"),
            title: .init(text: "被老公抓到了", color: .white),
            subtitle: .init(text: subtitle, color: UIColor.white.withAlphaComponent(0.72)),
            primaryButtonLabel: .init(text: "回去睡觉", color: .white),
            primaryButtonBackgroundColor: UIColor(red: 0.49, green: 0.31, blue: 0.91, alpha: 1),
            secondaryButtonLabel: state.unlocksRevoked
                ? nil
                : .init(text: "申请临时解锁", color: UIColor.white.withAlphaComponent(0.72))
        )
    }

    override func configuration(shielding application: Application) -> ShieldConfiguration { configuration }
    override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration { configuration }
    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration { configuration }
    override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration { configuration }
}
