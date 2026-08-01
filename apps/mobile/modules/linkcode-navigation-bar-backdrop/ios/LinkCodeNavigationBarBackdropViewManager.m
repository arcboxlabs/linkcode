#import <QuartzCore/QuartzCore.h>
#import <React/RCTViewManager.h>
#import <UIKit/UIKit.h>

@interface LinkCodeGradientMaskView : UIView
@end

@implementation LinkCodeGradientMaskView

+ (Class)layerClass
{
  return CAGradientLayer.class;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  self = [super initWithFrame:frame];
  if (self) {
    CAGradientLayer *gradient = (CAGradientLayer *)self.layer;
    gradient.colors = @[
      (id)UIColor.whiteColor.CGColor,
      (id)UIColor.whiteColor.CGColor,
      (id)UIColor.clearColor.CGColor
    ];
    gradient.locations = @[ @0, @0.82, @1 ];
    gradient.startPoint = CGPointMake(0.5, 0);
    gradient.endPoint = CGPointMake(0.5, 1);
    self.userInteractionEnabled = NO;
  }
  return self;
}

@end

@interface LinkCodeNavigationBarBackdropView : UIView
@property(nonatomic, strong) UIVisualEffectView *blurView;
@property(nonatomic, strong) LinkCodeGradientMaskView *gradientMask;
@property(nonatomic, assign) CGSize maskSize;
@end

@implementation LinkCodeNavigationBarBackdropView

- (instancetype)initWithFrame:(CGRect)frame
{
  self = [super initWithFrame:frame];
  if (self) {
    UIBlurEffect *effect =
        [UIBlurEffect effectWithStyle:UIBlurEffectStyleSystemChromeMaterial];
    _blurView = [[UIVisualEffectView alloc] initWithEffect:effect];
    _gradientMask = [[LinkCodeGradientMaskView alloc] initWithFrame:CGRectZero];
    _maskSize = CGSizeZero;

    self.userInteractionEnabled = NO;
    _blurView.userInteractionEnabled = NO;
    _blurView.maskView = _gradientMask;
    [self addSubview:_blurView];
  }
  return self;
}

- (void)layoutSubviews
{
  [super layoutSubviews];

  self.blurView.frame = self.bounds;
  if (CGSizeEqualToSize(self.maskSize, self.bounds.size)) {
    return;
  }

  self.maskSize = self.bounds.size;
  self.gradientMask.frame = self.blurView.bounds;
  self.blurView.maskView = nil;
  self.blurView.maskView = self.gradientMask;
}

@end

@interface LinkCodeNavigationBarBackdropViewManager : RCTViewManager
@end

@implementation LinkCodeNavigationBarBackdropViewManager

RCT_EXPORT_MODULE(LinkCodeNavigationBarBackdrop)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (UIView *)view
{
  return [[LinkCodeNavigationBarBackdropView alloc] initWithFrame:CGRectZero];
}

@end
